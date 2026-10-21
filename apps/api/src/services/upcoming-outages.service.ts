import type { GroupOutageSummary } from '@svitlo/shared';
import { localSlotToUtc } from './schedule-import.service.js';
import { listQueueSettlements, listQueueStreetNames } from './queues.service.js';

/**
 * Ближайшие плановые отключения области по группам — из `schedule_slots` оператора.
 *
 * Зачем это отдельный список, а не `outage_events`: в `outage_events` лежат точечные ремонтные
 * записи по конкретным адресам (одна область, одно село — «Деснянське»), и из-за них блок
 * «Найближчі відключення» на главной занимало одно и то же село, а по остальным областям было
 * пусто. Плановые отключения по группам живут в `schedule_slots` — это другой и гораздо более
 * полный источник, и именно его человек видит как «мой график».
 *
 * Пустой ответ — честный: нет слотов на даты области — значит нет графика. Подстановок
 * «демо-расписания» здесь быть не может (AGENTS.md, skills/svitlo-onboarding).
 */
export async function listUpcomingGroupOutages(
  region: string,
  days = 2,
  now: Date = new Date(),
): Promise<GroupOutageSummary[]> {
  const { db } = await import('../db/connection.js');
  const { scheduleSlots } = await import('../db/schema.js');
  const { and, eq, inArray } = await import('drizzle-orm');

  // Київські даты беруться з київського календаря: уночі 00:00–03:00 (де UTC-дата ще вчорашня)
  // інакше показали б минулу добу і «найближчі» відключення виявилися б учорашніми.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const baseDay = Date.UTC(pick('year'), pick('month') - 1, pick('day'));
  const dateList = Array.from({ length: Math.max(1, Math.min(days, 7)) }, (_, index) => {
    const day = new Date(baseDay + index * 86_400_000);
    return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
  });

  const rows = await db
    .select()
    .from(scheduleSlots)
    .where(and(eq(scheduleSlots.region, region), inArray(scheduleSlots.date, dateList)));

  const [settlementNames, streetNames] = await Promise.all([
    listQueueSettlements(region),
    listQueueStreetNames(region),
  ]);
  const nowMs = now.getTime();

  const grouped = new Map<string, GroupOutageSummary>();
  for (const row of rows) {
    // Только отключения (state 3). Статусы 1 и 2 — это «світло є» та розмин черг, им не место
    // в блоке отключений: показывать их значило бы заполнить экран «неотключениями».
    if (row.stateCode !== 3) continue;
    const key = `${row.date}|${row.queue}`;
    const startsAt = localSlotToUtc(row.date, row.timeFrom, false);
    const endsAt = localSlotToUtc(row.date, row.timeTo, true);
    const bucket = grouped.get(key) ?? {
      queue: row.queue,
      date: row.date,
      source: row.source,
      settlements: settlementNames.get(row.queue) ?? [],
      streetNames: streetNames.get(row.queue) ?? [],
      intervals: [],
      isActiveNow: false,
      nextStartsAt: null,
    };
    bucket.intervals.push({
      startsAt,
      endsAt,
      localTimeFrom: row.timeFrom,
      localTimeTo: row.timeTo,
      stateCode: 3,
      stateName: row.stateName,
      stateColor: row.stateColor,
    });
    // «Активно» = слот охоплює «зараз». Рахуємо на сервері, щоб головна й картки груп показували
    // однакове визначення, а не два різні годинники в клієнті.
    if (Date.parse(startsAt) <= nowMs && nowMs < Date.parse(endsAt)) bucket.isActiveNow = true;
    grouped.set(key, bucket);
  }

  return [...grouped.values()]
    .map((bucket) => ({
      ...bucket,
      intervals: bucket.intervals.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      nextStartsAt: bucket.intervals.find((item) => Date.parse(item.startsAt) > nowMs)?.startsAt ?? null,
    }))
    // Ближні зверху: активні групи, потім сьогоднішні за часом, потім завтрашні.
    .sort(
      (a, b) =>
        Number(b.isActiveNow) - Number(a.isActiveNow) ||
        a.date.localeCompare(b.date) ||
        (a.intervals[0]?.startsAt ?? '').localeCompare(b.intervals[0]?.startsAt ?? ''),
    );
}