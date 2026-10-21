import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Outage } from '@svitlo/shared';
import { db } from '../db/connection.js';
import { scheduleSlots, settlements, settlementQueues } from '../db/schema.js';
import { localSlotToUtc } from './schedule-import.service.js';

/** Код состояния «отключение» оператора (1 — свет есть, 2 — размин, 3 — отключение). */
const OFF_STATE_CODE = 3;

/** Київський сьогодні (YYYY-MM-DD). */
function kyivToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Київські дати з inclusively-діапазону [from, to]. */
function kyivDatesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // Предохранитель: больше 60 дней — уже не «расписание», а случайный ввод.
  if (end.getTime() - start.getTime() > 60 * 86_400_000) return dates;
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`,
    );
  }
  return dates;
}

/** Пріоритет черги як номера (2/2 → 2) — поле `queue` в API числовое. */
function queueNumber(queue: string): number {
  const value = Number.parseInt(queue.split('/')[0] ?? '', 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Отключения по графику ГПВ области — в виде обычных записей для /api/v1/outages.
 *
 * Зачем: страница «Відключення» раньше читала только `outage_events` (точечные ремонты одного
 * села), поэтому для 15 областей из 16 она была пустой, а фильтры дат и виды (календарь,
 * график, карта) нечего было показывать. График ГПВ из `schedule_slots` есть почти для всех
 * областей и по сути и ЕСТЬ отключения — люди читают его как «мой график».
 *
 * Честность разметки: такие записи помечены `kind: 'group'` и `source: 'schedule_slots'`,
 * а `reason` берётся из названия состояния оператора. Точечные ремонты остаются отдельными
 * записями (`kind: 'repair'`), и UI может их отличить.
 */
export async function listGroupOutages(
  region: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  now: Date,
): Promise<Outage[]> {
  const today = kyivToday(now);
  // Без явного окна показываем сегодня и завтра — это «ближайшие отключения», а не весь архив.
  const from = dateFrom ?? today;
  const to = dateTo ?? (dateFrom ? dateFrom : undefined) ?? today;
  const dates = kyivDatesBetween(from, dateTo ? to : from === today ? kyivDatesBetween(today, today)[0]! : to);

  if (dates.length === 0) return [];

  const rows = await db
    .select({
      queue: scheduleSlots.queue,
      date: scheduleSlots.date,
      timeFrom: scheduleSlots.timeFrom,
      timeTo: scheduleSlots.timeTo,
      stateName: scheduleSlots.stateName,
    })
    .from(scheduleSlots)
    .where(
      and(
        eq(scheduleSlots.region, region),
        eq(scheduleSlots.stateCode, OFF_STATE_CODE),
        inArray(scheduleSlots.date, dates),
      ),
    );

  if (rows.length === 0) return [];

  // Насёлённые пункты, привязанные к группам области, — чтобы в карточке было видно, кому
  // относится отключение. Пусто (источник не отдал географию) — это не повод ничего выдумывать.
  const settlementRows = await db
    .select({
      queue: settlementQueues.queue,
      name: settlements.name,
      regionName: settlements.region,
    })
    .from(settlementQueues)
    .innerJoin(settlements, eq(settlementQueues.settlementId, settlements.id))
    .where(eq(settlementQueues.region, region));

  const settlementsByQueue = new Map<string, string[]>();
  for (const row of settlementRows) {
    const list = settlementsByQueue.get(row.queue) ?? [];
    if (!list.includes(row.name)) list.push(row.name);
    settlementsByQueue.set(row.queue, list);
  }

  // Сливаем соседние/пересекающиеся окна одной группы и дня в одно отключение.
  //
  // Важно: сначала собираем ВСЕ слоты группы в список, и лишь потом склеиваем. Раньше здесь был
  // map[ключ] → одна запись, и новое окно, не подлежащее склейке, просто ПЕРЕЗАПИСЫВАЛО
  // предыдущее: у группы 1/1 (08:00–10:30 и 17:30–21:00) показывалось только второе окно,
  // а активное в данный момент отключение исчезало изо лжи вовсе.
  const sorted = [...rows].sort((a, b) =>
    a.date === b.date ? a.timeFrom.localeCompare(b.timeFrom) : a.date.localeCompare(b.date),
  );
  const slotsByKey = new Map<string, { queue: string; date: string; slots: { from: string; to: string; stateName: string }[] }>();
  for (const row of sorted) {
    const key = `${row.date}|${row.queue}`;
    const entry = slotsByKey.get(key) ?? { queue: row.queue, date: row.date, slots: [] };
    entry.slots.push({ from: row.timeFrom, to: row.timeTo, stateName: row.stateName });
    slotsByKey.set(key, entry);
  }

  const byKey = new Map<string, Outage>();
  for (const entry of slotsByKey.values()) {
    const places = settlementsByQueue.get(entry.queue) ?? [];
    const mergedWindows: { from: string; to: string }[] = [];
    for (const slot of entry.slots) {
      const last = mergedWindows[mergedWindows.length - 1];
      // Склеиваем, если окно начинается не позже конца предыдущего (в т.ч. вплотную).
      if (last && slot.from <= last.to) {
        if (slot.to > last.to) last.to = slot.to;
      } else {
        mergedWindows.push({ from: slot.from, to: slot.to });
      }
    }

    for (const [index, window] of mergedWindows.entries()) {
      const startsAt = localSlotToUtc(entry.date, window.from, false);
      const endsAt = localSlotToUtc(entry.date, window.to, true);
      const recordKey = `${entry.date}|${entry.queue}|${index}`;
      byKey.set(recordKey, {
        id: `group:${region}:${entry.queue}:${entry.date}:${window.from}`,
        startsAt,
        endsAt,
        areaName: places[0] ?? region,
        // Групповое отключение — не адресное, поэтому «адрес» здесь код черги и, если
        // привязка известна, населённые пункты группы.
        addressesRaw: places.length > 0
          ? `Черга ${entry.queue}: ${places.join(', ')}`
          : `Черга ${entry.queue}`,
        addressesNormalized: '',
        streets: places,
        reason: entry.slots[index]?.stateName ?? 'Відключення',
        status: statusOf(startsAt, endsAt, now),
        queue: queueNumber(entry.queue),
        source: 'schedule_slots',
        sourceId: '',
        contentHash: recordKey,
        kind: 'group',
        group: entry.queue,
        firstSeenAt: startsAt,
        updatedAt: startsAt,
      });
    }
  }

  return [...byKey.values()];
}

function statusOf(startsAt: string, endsAt: string, now: Date): 'scheduled' | 'active' | 'finished' {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (start > now.getTime()) return 'scheduled';
  if (end > now.getTime()) return 'active';
  return 'finished';
}