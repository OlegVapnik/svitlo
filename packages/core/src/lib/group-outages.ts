import type { GroupOutageSummary, Outage } from '@svitlo/shared';
import { OFF_STATE_CODE } from './scheduleWindow';

/**
 * Синтез плановых окон ГПВ для вкладки «Відключення».
 *
 * ЗАЧЕМ. `/api/v1/outages` отдаёт аварийные и ремонтные события ОСР. Плановые окна очередей
 * живут в расписании (`/schedules/upcoming`), и когда оператор опубликовал только график,
 * список «Планові відключення» оставался пустым — человек видел «нічого немає» при живом ГПВ.
 *
 * ЧЕСТНОСТЬ ДАТ. Берём окна ТОЛЬКО за сегодня и завтра. В зеркалах областей лежат архивные
 * даты (у Львова/Рівного/Тернополя июльские, у Запоріжжя апрельские), и без строгой проверки
 * они выглядели бы как сегодняшний график. Если на сегодня/завтра слотов нет — возвращаем
 * пустой список: страница покажет честное «оператор ще не опублікував графік».
 */
export interface GroupOutageSynthesisOptions {
  regionCpu: string;
  areaName: string;
  /** Сегодняшняя киевская дата `YYYY-MM-DD`. */
  todayKey: string;
  /** Завтрашняя киевская дата `YYYY-MM-DD`. */
  tomorrowKey: string;
  nowMs?: number;
}

/** Одно окно группы → карточка отключения с явной пометкой `kind: 'group'`. */
export function synthesizeGroupOutages(
  buckets: GroupOutageSummary[] | undefined,
  options: GroupOutageSynthesisOptions,
): Outage[] {
  const nowMs = options.nowMs ?? Date.now();
  const result: Outage[] = [];

  for (const bucket of buckets ?? []) {
    if (bucket.date !== options.todayKey && bucket.date !== options.tomorrowKey) continue;
    for (const interval of bucket.intervals) {
      if (interval.stateCode !== OFF_STATE_CODE) continue;
      const start = Date.parse(interval.startsAt);
      const end = Date.parse(interval.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      result.push({
        id: `gpv:${options.regionCpu}:${bucket.queue}:${bucket.date}:${interval.localTimeFrom}-${interval.localTimeTo}`,
        startsAt: interval.startsAt,
        endsAt: interval.endsAt,
        areaName: options.areaName,
        // У группы нет адреса — карточка не показывает раскрывающийся список адресов.
        addressesRaw: '',
        addressesNormalized: '',
        kind: 'group',
        group: bucket.queue,
        reason: null,
        status: start <= nowMs && nowMs < end ? 'active' : start > nowMs ? 'scheduled' : 'finished',
        queue: null,
        source: bucket.source,
        sourceId: '',
        contentHash: '',
        firstSeenAt: interval.startsAt,
        updatedAt: interval.startsAt,
      });
    }
  }

  return result.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}

/**
 * Слияние окон из API и синтезированных из ГПВ без дублей.
 *
 * Ключ — группа + начало + конец. Одно и то же окно может прийти и как событие ОСР, и как слот
 * расписания; две карточки на один период человек прочитает как два разных отключения.
 */
export function mergeGroupOutages(apiOutages: Outage[], synthesized: Outage[]): Outage[] {
  const seen = new Set<string>();
  const keyOf = (outage: Outage) =>
    `${outage.group ?? ''}|${outage.startsAt}|${outage.endsAt}`;

  const merged: Outage[] = [];
  for (const outage of apiOutages) {
    seen.add(keyOf(outage));
    // У события ОСР группы нет — для него совпадение по времени и есть дубль. Для группового
    // окна такой ключ нельзя добавлять: две разные очереди в одно время — не дубль.
    if (!outage.group) seen.add(`|${outage.startsAt}|${outage.endsAt}`);
    merged.push(outage);
  }
  for (const outage of synthesized) {
    if (seen.has(keyOf(outage))) continue;
    seen.add(keyOf(outage));
    merged.push(outage);
  }
  return merged.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}
