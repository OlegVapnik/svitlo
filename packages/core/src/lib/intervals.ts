/**
 * Добові інтервали для UI: хвилини від київської півночі, склейка й формати.
 *
 * `mergeIntervals` і «хвилини за Києвом» переїхали в `@svitlo/domain`: те саме правило
 * потрібне й воркеру (парсери прямих джерел), а три власні реалізації склейки вже
 * розходилися в деталях. Тут лишається тільки клієнтське: переклад склеєних вікон назад
 * у ISO для шкали доби і людські формати тривалості.
 */
import { kyivWallClockMs, shiftYmd } from '@svitlo/domain';
import type { MinuteInterval } from '@svitlo/domain';

export type { MinuteInterval } from '@svitlo/domain';
export { mergeIntervals } from '@svitlo/domain';

/**
 * Склеенные интервалы обратно в ISO-строки — чтобы скормить их `Timeline24h`.
 *
 * Перевод «киевское настенное время → UTC» делает `kyivWallClockMs` из домена: там та же
 * арифметика перевода часов, что у Worker'а, и она верно обрабатывает конец суток.
 *
 * Конец суток (`24:00`) — это полночь СЛЕДУЮЩЕЙ даты, а не `00:00` текущей. Прежняя
 * реализация делила минуты на 60 по модулю 24 и отдавала для `24:00` начало отображаемых
 * суток: интервал «18:00 – 24:00» приезжал как «18:00 – 00:00», то есть конец раньше
 * начала. На обычном дне это маскировалось тем, что оба конца считались по одному
 * смещению, а в ночь перевода часов ещё и уезжало на час.
 */
export function toIsoIntervals(
  windows: MinuteInterval[],
  date: string,
): Array<{ startsAt: string; endsAt: string; stateCode: 1 | 2 | 3; stateName: string; stateColor: string }> {
  const wallToIso = (minutes: number): string => {
    const day = minutes >= 24 * 60 ? shiftYmd(date, 1) : date;
    const inDay = minutes % (24 * 60);
    const time = `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`;
    return new Date(kyivWallClockMs(day, time, false)).toISOString();
  };

  return windows.map((window) => ({
    startsAt: wallToIso(window.startMin),
    endsAt: wallToIso(window.endMin),
    stateCode: 3,
    stateName: 'off',
    stateColor: '',
  }));
}

/** «6 год 30 хв» / «45 хв» — длительность окна словами, а не числом получасовых слотов. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} хв`;
  if (rest === 0) return `${hours} год`;
  return `${hours} год ${rest} хв`;
}

/**
 * «18:00» по киевскому времени из минут от полуночи.
 *
 * Конец суток — это «24:00», а не «00:00»: интервал `06:00 – 24:00` читается как
 * «с шести утра до конца дня», тогда как `06:00 – 00:00` выглядит как шаг назад по времени.
 */
export function formatMinutes(minutes: number): string {
  const clamped = Math.min(Math.max(minutes, 0), 24 * 60);
  if (clamped >= 24 * 60) return '24:00';
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}