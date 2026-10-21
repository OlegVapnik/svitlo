import { FastifyInstance } from 'fastify';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { regions, scheduleSlots } from '../db/schema.js';
import { canonicalQueue, isQueueCode } from '../services/address-lookup.service.js';
import type { OutageRow } from '../services/power-summary.js';
import {
  buildQueueSummary,
  buildRegionSummaries,
  buildReliabilityReport,
  kyivMonthStart,
  type RegionReliabilityInput,
  type ReliabilityForecast,
} from '../services/reliability.js';
import { readRegionParam } from '../services/regions.service.js';
import { AppError } from '../utils/errors.js';

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

/** Киевская дата следующего дня — её график оператор публикует заранее. */
function nextKyivDate(now: Date): string {
  const tomorrow = new Date(now.getTime() + 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(tomorrow);
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
   * Необязательные ветки отчёта:
   * - `byRegionSummary` — те же цифры по всем областям, чтобы сравнить «як у мене і як поруч»;
   * - `queue` при `?queue=2/2` — надёжность конкретной группы, а не среднее по области.
   */
  fastify.get<{ Querystring: { region?: string; queue?: string } }>('/api/v1/reliability', async (req) => {
    const now = new Date();
    const region = readRegionParam(req.query.region);
    // Строка очереди нормализуется (`2.2` → `2/2`), а мусор отвергается: он ушёл бы в ответ
    // как «группа, которой нет», и человек искал бы в списке несуществующую чергу.
    const rawQueue = String(req.query.queue ?? '').trim();
    const queue = rawQueue ? canonicalQueue(rawQueue) : null;
    if (queue && !isQueueCode(queue)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'queue має бути кодом черги, напр. 2/2');
    }

    const from = kyivMonthStart(now);
    // Киевская дата начала месяца: слоты хранятся по дате, а не по UTC-моменту.
    const fromDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(from);
    const dates = kyivDatesBetween(fromDate, now);
    const tomorrow = nextKyivDate(now);
    // Завтрашнюю дату запрашиваем тем же запросом: любые строки на неё означают «графік на завтра
    // опубліковано» — это и есть честный прогноз, а не выдуманные данные.
    const allDates = [...dates, tomorrow];

    // Четыре запроса разом, без N+1: слоты области, покрытие по всем областям (какие дни вообще
    // опубликованы), отключения по всем областям для сводки и каталог названий областей.
    const [regionRows, coverageRows, allOffRows, nameRows] = await Promise.all([
      db
        .select({
          queue: scheduleSlots.queue,
          date: scheduleSlots.date,
          timeFrom: scheduleSlots.timeFrom,
          timeTo: scheduleSlots.timeTo,
          stateCode: scheduleSlots.stateCode,
        })
        .from(scheduleSlots)
        .where(and(eq(scheduleSlots.region, region), inArray(scheduleSlots.date, allDates))),
      db
        .selectDistinct({ region: scheduleSlots.region, date: scheduleSlots.date })
        .from(scheduleSlots)
        .where(inArray(scheduleSlots.date, allDates)),
      db
        .select({
          region: scheduleSlots.region,
          queue: scheduleSlots.queue,
          date: scheduleSlots.date,
          timeFrom: scheduleSlots.timeFrom,
          timeTo: scheduleSlots.timeTo,
        })
        .from(scheduleSlots)
        .where(and(eq(scheduleSlots.stateCode, OFF_STATE_CODE), inArray(scheduleSlots.date, allDates))),
      db.select({ cpu: regions.cpu, nameUa: regions.nameUa }).from(regions),
    ]);

    const byQueue = new Map<string, OutageRow[]>();
    const tomorrowRows: OutageRow[] = [];
    const tomorrowByQueue = new Map<string, OutageRow[]>();
    const coveredDates = new Set<string>();
    for (const row of regionRows) {
      // Любая строка (даже код 1 «світло за графіком») — это «графік опубліковано на цю дату».
      coveredDates.add(row.date);
      if (row.stateCode !== OFF_STATE_CODE) continue;
      const interval: OutageRow = {
        startsAt: slotToUtc(row.date, row.timeFrom, false),
        endsAt: slotToUtc(row.date, row.timeTo, true),
      };
      if (row.date === tomorrow) {
        tomorrowRows.push(interval);
        const tomorrowList = tomorrowByQueue.get(row.queue) ?? [];
        tomorrowList.push(interval);
        tomorrowByQueue.set(row.queue, tomorrowList);
        continue;
      }
      const list = byQueue.get(row.queue) ?? [];
      list.push(interval);
      byQueue.set(row.queue, list);
    }

    // `?queue=` сужает весь отчёт до одной группы — включая бакеты по днях: иначе в строке дня
    // смешивались бы «моя группа» и остальные, и цифра не сходилась бы с подписью.
    const scoped = queue ? new Map<string, OutageRow[]>([[queue, byQueue.get(queue) ?? []]]) : byQueue;
    // Плоский список нужен только для построения отчёта без группировки; при группировке он не
    // влияет на расчёт, но держит сигнатуру совместимой.
    const flat = [...scoped.values()].flat();

    // Прогноз отдаём, только если на завтра есть график: пустого «завтра» в отчёте быть не должно.
    const forecast: ReliabilityForecast | undefined = regionRows.some((row) => row.date === tomorrow)
      ? { date: tomorrow, rows: tomorrowRows, byQueue: tomorrowByQueue }
      : undefined;

    const regionsInput = new Map<string, RegionReliabilityInput>();
    for (const row of coverageRows) {
      const input = regionsInput.get(row.region) ?? { dates: new Set<string>(), byQueue: new Map<string, OutageRow[]>() };
      input.dates.add(row.date);
      regionsInput.set(row.region, input);
    }
    for (const row of allOffRows) {
      const input = regionsInput.get(row.region) ?? { dates: new Set<string>(), byQueue: new Map<string, OutageRow[]>() };
      const list = input.byQueue.get(row.queue) ?? [];
      list.push({
        startsAt: slotToUtc(row.date, row.timeFrom, false),
        endsAt: slotToUtc(row.date, row.timeTo, true),
      });
      input.byQueue.set(row.queue, list);
      regionsInput.set(row.region, input);
    }

    const report = buildReliabilityReport(now, flat, scoped, forecast);
    const names = new Map(nameRows.map((row) => [row.cpu, row.nameUa]));
    return {
      data: {
        ...report,
        byRegionSummary: buildRegionSummaries(now, regionsInput, names),
        queue: queue ? buildQueueSummary(queue, scoped.get(queue) ?? [], coveredDates, now) : null,
      },
    };
  });
}