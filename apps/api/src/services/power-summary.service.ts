import { and, eq, gte, inArray, lte, or } from 'drizzle-orm';
import type { PowerSummary, PowerWindowSummary } from '@svitlo/shared';
import { db } from '../db/connection.js';
import { scheduleSlots } from '../db/schema.js';
import { computeWindowSummary, kyivDayStart } from './power-summary.js';

/** Код состояния «отключение» оператора (1 — свет есть, 2 — размин, 3 — отключение). */
const OFF_STATE_CODE = 3;

/**
 * Окно по графику ГПВ области: сколько типичная группа без света.
 *
 * Почему НЕ сумма интервалов по всем группам: группы отключаются по очереди (разнесённые по
 * часам окна), и сумма дала бы «область без света 20 часов из 24», хотя в каждый момент света
 * нет только у части людей. Поэтому считаем среднее по группам — это честная величина для
 * конкретного человека: столько часов без света у группы, куда попалёшь ты.
 */
async function summarizeWindow(
  label: string,
  region: string,
  start: Date,
  end: Date,
): Promise<PowerWindowSummary> {
  const kyiv = (value: string) => `${value}`;

  // Границы окна в киевских сутках: слоты хранятся по дате, а не по UTC-моменту.
  const startDate = kyiv(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(start));
  const endDate = kyiv(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(end));

  const rows = await db
    .select({
      queue: scheduleSlots.queue,
      date: scheduleSlots.date,
      timeFrom: scheduleSlots.timeFrom,
      timeTo: scheduleSlots.timeTo,
    })
    .from(scheduleSlots)
    .where(
      and(
        eq(scheduleSlots.region, region),
        eq(scheduleSlots.stateCode, OFF_STATE_CODE),
        inArray(scheduleSlots.date, [startDate, endDate]),
      ),
    );

  if (rows.length === 0) {
    return computeWindowSummary(label, start, end, []);
  }

  // Слоти → интервалы UTC той же логікою, що й в /api/v1/schedules, щоб цифри сходилися.
  const byQueue = new Map<string, { start: number; end: number }[]>();
  for (const row of rows) {
    const from = Date.parse(localSlotUtc(row.date, row.timeFrom, false));
    const to = Date.parse(localSlotUtc(row.date, row.timeTo, true));
    if (Number.isNaN(from) || Number.isNaN(to)) continue;
    const list = byQueue.get(row.queue) ?? [];
    list.push({ start: from, end: to });
    byQueue.set(row.queue, list);
  }

  // Обмежуємо інтервали вікном і рахуємо середнє по групах.
  const perQueueMinutes: number[] = [];
  for (const intervals of byQueue.values()) {
    const clipped = intervals.map((interval) => ({
      startsAt: new Date(Math.max(interval.start, start.getTime())),
      endsAt: new Date(Math.min(interval.end, end.getTime())),
    }));
    const withPower = computeWindowSummary(label, start, end, clipped);
    if (withPower.outageMinutes > 0) perQueueMinutes.push(withPower.outageMinutes);
  }

  if (perQueueMinutes.length === 0) return computeWindowSummary(label, start, end, []);

  const outageMinutes = Math.round(perQueueMinutes.reduce((sum, value) => sum + value, 0) / perQueueMinutes.length);
  const windowMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const poweredMinutes = Math.max(0, windowMinutes - outageMinutes);
  const reliabilityPct = windowMinutes > 0 ? Math.round((poweredMinutes / windowMinutes) * 1000) / 10 : 100;

  return {
    windowLabel: label,
    windowMinutes,
    outageMinutes,
    poweredMinutes,
    reliabilityPct,
    // Кількість груп — щоб «скільки без світла» можна було прочитати як «у середньому по N групах».
    outageCount: perQueueMinutes.length,
    hasData: true,
  };
}

/** Межа слота (київський локальний час) → ISO UTC. Дублює логіку schedule-import, щоб не розходилось. */
function localSlotUtc(date: string, time: string, end: boolean): string {
  if (end && time === '00:00') {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${nextDate}T12:00:00Z`))
      .find((part) => part.type === 'timeZoneName')?.value?.match(/GMT([+-])(\d{2}):(\d{2})/u);
    const sign = offset?.[1] === '-' ? -1 : 1;
    const minutes = offset ? sign * (Number(offset[2]) * 60 + Number(offset[3])) : 120;
    return new Date(Date.parse(`${nextDate}T00:00:00Z`) - minutes * 60_000).toISOString();
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!) - kyivOffsetFor(date) * 60_000).toISOString();
}

/** Зсув Києва у хвилинах для конкретної дати. */
function kyivOffsetFor(date: string): number {
  const value = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === 'timeZoneName')?.value?.match(/GMT([+-])(\d{2}):(\d{2})/u);
  const sign = value?.[1] === '-' ? -1 : 1;
  return value ? sign * (Number(value[2]) * 60 + Number(value[3])) : 120;
}

/**
 * «Надійність» електропостачання области за графіком ГПВ: скільки часу на добу типова група
 * була без світла і скільки — зі свтлом.
 *
 * Раніше рахувалося по `outage_events` (точкові ремонтні відключення) — але їх одиниці, і коли
 * аварійний збір вимкнено, статистика обнулялася, хоча реальний графік по групах був у базі.
 * Тепер джерело — `schedule_slots`: це те саме, за чим люди живуть.
 */
export async function getPowerSummary(region: string, now: Date = new Date()): Promise<PowerSummary> {
  const [today, last24h] = await Promise.all([
    summarizeWindow('за добу', region, kyivDayStart(now), now),
    summarizeWindow('за 24 години', region, new Date(now.getTime() - 24 * 3_600_000), now),
  ]);
  return { today, last24h };
}