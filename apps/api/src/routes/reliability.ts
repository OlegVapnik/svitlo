import { FastifyInstance } from 'fastify';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { scheduleSlots } from '../db/schema.js';
import type { OutageRow } from '../services/power-summary.js';
import { buildReliabilityReport, kyivMonthStart } from '../services/reliability.js';
import { readRegionParam } from '../services/regions.service.js';

/** Код состояния «отключение» оператора (1 — свет есть, 2 — размин, 3 — отключение). */
const OFF_STATE_CODE = 3;

/** Зсув Europe/Kyiv в минутах для даты YYYY-MM-DD. */
function kyivOffsetMinutes(date: string): number {
  const value = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === 'timeZoneName')?.value?.match(/GMT([+-])(\d{2}):(\d{2})/u);
  const sign = value?.[1] === '-' ? -1 : 1;
  return value ? sign * (Number(value[2]) * 60 + Number(value[3])) : 120;
}

/** Граница слота (киевский локальный час) → момент UTC. Тот же перевод, что в /api/v1/schedules. */
function slotToUtc(date: string, time: string, end: boolean): Date {
  if (end && time === '00:00') {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return new Date(Date.parse(`${nextDate}T00:00:00Z`) - kyivOffsetMinutes(nextDate) * 60_000);
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!) - kyivOffsetMinutes(date) * 60_000);
}

/** Пара соседних дат киевского календаря — окно от даты `from` до `now`. */
function kyivDatesBetween(from: string, now: Date): string[] {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(now);
  const dates: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`);
  }
  return dates;
}

export default async function reliabilityRoutes(fastify: FastifyInstance) {
  /**
   * Надійність електропостачання по днях / тижнях / місяцях, з початку поточного місяця.
   *
   * Источник — `schedule_slots` (график ГПВ по группам), а не `outage_events`: там лежат
   * единичные точечные ремонты, из-за чего вся статистика была пустой. Группы — это то, за чем
   * человек живёт: сколько часов без света в его группе.
   *
   * Считается среднее по группам, а не сумма: окна групп разнесены по часам, и сумма дала бы
   * «20 часов без света из 24», хотя света нет лишь у части людей (см. services/reliability.ts).
   */
  fastify.get<{ Querystring: { region?: string } }>('/api/v1/reliability', async (req) => {
    const now = new Date();
    const region = readRegionParam(req.query.region);
    const from = kyivMonthStart(now);
    // Киевская дата начала месяца: слоты хранятся по дате, а не по UTC-моменту.
    const fromDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(from);
    const dates = kyivDatesBetween(fromDate, now);

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
          inArray(scheduleSlots.date, dates),
        ),
      );

    const byQueue = new Map<string, OutageRow[]>();
    for (const row of rows) {
      const list = byQueue.get(row.queue) ?? [];
      list.push({
        startsAt: slotToUtc(row.date, row.timeFrom, false),
        endsAt: slotToUtc(row.date, row.timeTo, true),
      });
      byQueue.set(row.queue, list);
    }

    // Плоский список нужен только для построения отчёта без группировки; при группировке он не
    // влияет на расчёт, но держит сигнатуру совместимой.
    const flat = [...byQueue.values()].flat();
    return { data: buildReliabilityReport(now, flat, byQueue) };
  });
}