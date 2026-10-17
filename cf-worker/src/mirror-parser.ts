/**
 * Чистый разбор payload зеркала ГПВ: JSON → слоты + покрытие.
 *
 * Без I/O, без Env, без D1. Именно поэтому модуль можно прогнать на сохранённом ответе зеркала и
 * сравнить с тем, что уже лежит в базе: расхождение видно до деплоя, а не в проде.
 */

import { halfHourLabels, kyivToday } from './kyiv-time.js';
import { cellCode, MIRROR_OFF_CODE, offIntervalsFromCodes, queueFromGroupKey } from './schedule-utils.js';

/** Интервал отключения одной очереди на одну дату. */
export interface Slot {
  region: string;
  queue: string;
  date: string;
  timeFrom: string;
  timeTo: string;
}

/**
 * Строка покрытия ГПВ: «на эту дату оператор опубликовал график, и эта очередь в нём есть».
 *
 * Отдельно от `Slot` (`Slot` — только часы отключений). Причина: зеркало отдаёт
 * `schedule[группа][дата][HH:MM] = код`, где код 1 — «светло по графику», код 2 — «отключение».
 * По одним слотам (код 2) невозможно отличить «оператор опубликовал график без отключений» от
 * «оператор на эту дату ничего не публиковал»: и то, и другое давало пустой список слотов, и
 * приложение писало «Немає даних» там, где график есть.
 */
export interface CoverageEntry {
  region: string;
  date: string;
  queue: string;
  /** Есть ли в опубликованном ГПВ хотя бы одна получасовка отключения для этой очереди. */
  hasOutages: boolean;
}

/**
 * Очередь-маркер «оператор сообщил про всю область целиком», а не про конкретную очередь.
 *
 * Нужна для постов вида «Графіки не діють» / «Погодинні відключення не застосовуються»: оператор
 * говорит про область и дату, а не про номер очереди. Такой пост — это покрытие (график
 * опубликован) без отключений, и именно поэтому регион перестаёт выглядеть «без данных».
 */
export const ALL_CLEAR_QUEUE = '*';

/** Дата в формате `YYYY-MM-DD`. */
export function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Разворачивает `{body: "<json>"}` во внутренний JSON.
 *
 * Зеркало отдаёт полезную нагрузку JSON-строкой внутри поля `body`, поэтому без этого шага
 * слоты не найдутся. Поддерживаем и вариант без обёртки — тогда `regions` лежит в корне.
 */
export function unwrapMirrorPayload(raw: unknown): Record<string, unknown> | null {
  if (!isJsonObject(raw)) return null;
  const body = raw['body'];
  if (typeof body === 'string') {
    try {
      const inner: unknown = JSON.parse(body);
      return isJsonObject(inner) ? inner : null;
    } catch {
      return null;
    }
  }
  if (isJsonObject(body)) return body;
  if ('regions' in raw || 'data' in raw) return raw;
  return null;
}

/** Список регионов из payload: и `{regions}`, и `{data: {regions}}`. */
function regionsOf(payload: Record<string, unknown>): unknown[] | null {
  const direct = payload['regions'];
  if (Array.isArray(direct)) return direct;
  const data = payload['data'];
  if (isJsonObject(data) && Array.isArray(data['regions'])) return data['regions'] as unknown[];
  return null;
}

/** Компактный массив на 48 кодов (второй формат ядра: `region.today` / `region.tomorrow`). */
function offIntervalsFromCompactArray(arr: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (!Array.isArray(arr) || arr.length !== 48) return [];
  const labels = halfHourLabels();
  return offIntervalsFromCodes(
    arr.map((value) => cellCode(value)),
    labels,
  );
}

/** Мапа `{"08:00": 2, …}` одного дня → интервалы отключений. */
function offIntervalsFromDayMap(day: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (!isJsonObject(day)) return [];
  const labels = halfHourLabels();
  return offIntervalsFromCodes(
    labels.map((label) => cellCode(day[label])),
    labels,
  );
}

/** Слоты отключений одной области из разобранного payload зеркала. Чистая функция. */
export function extractSlots(payload: Record<string, unknown>, regionCpu: string): Slot[] {
  const regions = regionsOf(payload);
  if (!regions) return [];
  const region = regions.find((item) => isJsonObject(item) && item['cpu'] === regionCpu);
  if (!isJsonObject(region)) return [];

  const slots: Slot[] = [];
  const dateToday = typeof payload['date_today'] === 'string' ? payload['date_today'] : null;
  const dateTomorrow = typeof payload['date_tomorrow'] === 'string' ? payload['date_tomorrow'] : null;

  // Формат 2: компактные массивы `today`/`tomorrow`. Без названия группы в самом регионе код
  // группы взять неоткуда — тогда честно не пишем ничего.
  if (Array.isArray(region['today'])) {
    const queue = queueFromGroupKey(String(region['group'] ?? ''));
    if (!queue) return [];
    for (const [date, compact] of [
      [dateToday, region['today']],
      [dateTomorrow, region['tomorrow']],
    ] as Array<[string | null, unknown]>) {
      if (!date || !isYmd(date)) continue;
      for (const interval of offIntervalsFromCompactArray(compact)) {
        slots.push({ region: regionCpu, queue, date, ...interval });
      }
    }
    return slots;
  }

  // Формат 1 (реальный): `schedule[groupKey][date][HH:MM] = code`.
  const schedule = region['schedule'];
  if (!isJsonObject(schedule)) return [];
  for (const [groupKey, byDate] of Object.entries(schedule)) {
    const queue = queueFromGroupKey(groupKey);
    if (!queue || !isJsonObject(byDate)) continue;
    for (const [date, day] of Object.entries(byDate)) {
      if (!isYmd(date)) continue;
      for (const interval of offIntervalsFromDayMap(day)) {
        slots.push({ region: regionCpu, queue, date, ...interval });
      }
    }
  }
  return slots;
}

/** Покрытие одной области из разобранного payload зеркала. Чистая функция. */
export function extractCoverage(
  payload: Record<string, unknown>,
  regionCpu: string,
): CoverageEntry[] {
  const regions = regionsOf(payload);
  if (!regions) return [];
  const region = regions.find((item) => isJsonObject(item) && item['cpu'] === regionCpu);
  if (!isJsonObject(region)) return [];

  const labels = halfHourLabels();
  const entries: CoverageEntry[] = [];
  const push = (queue: string, date: string, codes: Array<number | null>) => {
    entries.push({
      region: regionCpu,
      date,
      queue,
      hasOutages: codes.some((code) => code === MIRROR_OFF_CODE),
    });
  };

  const dateToday = typeof payload['date_today'] === 'string' ? payload['date_today'] : null;
  const dateTomorrow = typeof payload['date_tomorrow'] === 'string' ? payload['date_tomorrow'] : null;

  // Формат 2: компактные массивы на 48 получасовок. Без имени группы взять её неоткуда.
  if (Array.isArray(region['today'])) {
    const queue = queueFromGroupKey(String(region['group'] ?? ''));
    if (!queue) return [];
    for (const [date, compact] of [
      [dateToday, region['today']],
      [dateTomorrow, region['tomorrow']],
    ] as Array<[string | null, unknown]>) {
      if (!date || !isYmd(date) || !Array.isArray(compact) || compact.length !== 48) continue;
      push(queue, date, compact.map((value) => cellCode(value)));
    }
    return entries;
  }

  // Формат 1 (реальный): `schedule[groupKey][date][HH:MM] = code`.
  const schedule = region['schedule'];
  if (!isJsonObject(schedule)) return [];
  for (const [groupKey, byDate] of Object.entries(schedule)) {
    const queue = queueFromGroupKey(groupKey);
    if (!queue || !isJsonObject(byDate)) continue;
    for (const [date, day] of Object.entries(byDate)) {
      if (!isYmd(date) || !isJsonObject(day)) continue;
      push(queue, date, labels.map((label) => cellCode(day[label])));
    }
  }

  // Регион отдал список групп, но НИ ОДНОЙ даты с графиком (`schedule: { "1.1": {} }`) — именно так
  // зеркало присылает Киев. Это не «нет данных», а «график опубликован, отключений не
  // запланировано»: без служебной строки покрытия область с живым графиком показывала «Даних
  // графіка немає». Пишем `ALL_CLEAR_QUEUE` на сегодня — по ней `covered`/`allClear` станут true, и
  // человек увидит «Світло за графіком (відключень не заплановано)».
  if (entries.length === 0 && Object.keys(schedule).length > 0) {
    const date = dateToday && isYmd(dateToday) ? dateToday : kyivToday();
    entries.push({ region: regionCpu, date, queue: ALL_CLEAR_QUEUE, hasOutages: false });
  }
  return entries;
}

/**
 * Склеивает соседние интервалы группы в один.
 *
 * Зеркало отдаёт получасовки, поэтому отключение с 00:00 до 04:00 приходит двадцатью
 * восемью интервалами. Фронтенд ждёт готовые интервалы, а человек — одно окно в графике.
 */
export function mergeSlots(slots: Slot[]): Slot[] {
  const byKey = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.region}|${slot.queue}|${slot.date}`;
    const list = byKey.get(key);
    if (list) list.push(slot);
    else byKey.set(key, [slot]);
  }

  const merged: Slot[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.timeFrom.localeCompare(b.timeFrom));
    for (const slot of list) {
      const last = merged[merged.length - 1];
      // Склеиваем, только если предыдущий интервал того же отключения заканчивается там же,
      // где следующий начинается, и оба принадлежат той же группе/дате.
      const sameSeries =
        last !== undefined &&
        last.region === slot.region &&
        last.queue === slot.queue &&
        last.date === slot.date;
      if (sameSeries && last.timeTo === slot.timeFrom) last.timeTo = slot.timeTo;
      else merged.push({ ...slot });
    }
  }
  return merged;
}

/** Склеивает покрытие: одна строка на (область, дата, очередь). */
export function mergeCoverage(entries: CoverageEntry[]): CoverageEntry[] {
  const byKey = new Map<string, CoverageEntry>();
  for (const entry of entries) {
    const key = `${entry.region}|${entry.date}|${entry.queue}`;
    const existing = byKey.get(key);
    if (existing) existing.hasOutages = existing.hasOutages || entry.hasOutages;
    else byKey.set(key, { ...entry });
  }
  return [...byKey.values()];
}

/** Все `cpu`, которые реально присутствуют в payload. */
export function listRegionCpus(payload: Record<string, unknown>): string[] {
  const regions = regionsOf(payload);
  if (!regions) return [];
  const cpus: string[] = [];
  for (const item of regions) {
    if (isJsonObject(item) && typeof item['cpu'] === 'string') cpus.push(item['cpu']);
  }
  return cpus;
}

/**
 * Названия областей, которые прислало зеркало (`name_ua`).
 *
 * Нужны как резерв для подписи: зашитый каталог знает 24 области и Киев, а фид отдаёт ещё и
 * городские сети. Без этого человек видел бы технический слаг вместо названия области.
 */
export function listRegionNames(payload: Record<string, unknown>): Record<string, string> {
  const regions = regionsOf(payload);
  if (!regions) return {};
  const names: Record<string, string> = {};
  for (const item of regions) {
    if (!isJsonObject(item)) continue;
    const cpu = item['cpu'];
    const nameUa = item['name_ua'];
    if (typeof cpu === 'string' && cpu && typeof nameUa === 'string' && nameUa.trim()) {
      names[cpu] = nameUa.trim();
    }
  }
  return names;
}
