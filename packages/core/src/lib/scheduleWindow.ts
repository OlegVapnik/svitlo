import type { ScheduleIntervalUtc } from '@svitlo/shared';

/**
 * Расчёт «окна» графика очереди по киевским суткам. Вынесено из полосы суток
 * (components/schedule/QueueScheduleBar.tsx), потому что ту же математику использует герой главной
 * («є світло зараз і коли повернеться»). Дублировать её в двух местах нельзя: разъедутся цифры.
 *
 * API отдаёт интервалы ISO-в-UTC, а график оператора построен по местным суткам 00:00–24:00,
 * поэтому каждую границу переводим в минуту суток относительно киевской даты (см. skills/kyiv-time).
 */

/** Код состояния оператора: 1 — світло є, 2 — розмін черги/підчерги, 3 — відключення. */
export const OFF_STATE_CODE = 3;

/** Летнее/зимнее смещение Киева (+3/+2 ч) для конкретной даты YYYY-MM-DD. */
export function kyivOffset(date: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'shortOffset' });
  const part = formatter.formatToParts(new Date(`${date}T12:00:00Z`)).find((item) => item.type === 'timeZoneName')?.value ?? 'GMT+2';
  return part.endsWith('+3') ? 180 : 120;
}

/** Минута суток (0..1440) для момента ISO, попавшего в выбранные киевские сутки. */
export function minutesOfDay(iso: string, date: string): number {
  const offsetMin = kyivOffset(date);
  const value = (Date.parse(iso) - Date.parse(`${date}T00:00:00Z`) + offsetMin * 60_000) / 60_000;
  return Math.max(0, Math.min(24 * 60, Math.round(value)));
}

/** Длительность по-украински: «45 хв», «1 год», «1 год 20 хв» (без «0 год 45 хв» и «1 год 0 хв»). */
export function formatMinutesUk(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  if (minutes < 60) return `${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} год` : `${hours} год ${rest} хв`;
}

/** Минута суток → «06:00» (подписи в полосе суток и в подсказках). */
export function minutesToHm(minutes: number): string {
  const value = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export interface ScheduleWindow {
  /** Минута суток для «зараз» либо null, если сейчас не эти сутки (например, график на завтра). */
  nowMinutes: number | null;
  /** Интервал, в который попадает «зараз». */
  current: ScheduleIntervalUtc | null;
  /** Есть ли отключение прямо сейчас (stateCode 3). */
  isOff: boolean;
  /** Конец текущего отключения. */
  offEndsAt: string | null;
  /** Начало ближайшего отключения впереди. */
  nextStartsAt: string | null;
  /** Минут до ближайшего отключения (когда свет есть). */
  nextInMinutes: number | null;
  /** Минут до возвращения света (когда отключение идёт). */
  backInMinutes: number | null;
  /** Сколько минут без света за сутки по графику. */
  offMinutes: number;
}

/** Сводка по суткам: что сейчас, когда следующее отключение, сколько без света за день. */
export function scheduleWindow(intervals: ScheduleIntervalUtc[], date: string, now: Date = new Date()): ScheduleWindow {
  const dayStartUtcMs = Date.parse(`${date}T00:00:00Z`) - kyivOffset(date) * 60_000;
  const isChosenDay = now.getTime() >= dayStartUtcMs && now.getTime() < dayStartUtcMs + 24 * 60 * 60_000;
  const nowMinutes = isChosenDay ? (now.getTime() - dayStartUtcMs) / 60_000 : null;

  const offMinutes = intervals
    .filter((interval) => interval.stateCode === OFF_STATE_CODE)
    .reduce((sum, interval) => sum + minutesOfDay(interval.endsAt, date) - minutesOfDay(interval.startsAt, date), 0);

  const current =
    intervals.find(
      (interval) =>
        nowMinutes != null &&
        minutesOfDay(interval.startsAt, date) <= nowMinutes &&
        nowMinutes < minutesOfDay(interval.endsAt, date),
    ) ?? null;
  const isOff = current?.stateCode === OFF_STATE_CODE;

  const nextOff =
    intervals.find((interval) => interval.stateCode === OFF_STATE_CODE && minutesOfDay(interval.startsAt, date) > (nowMinutes ?? -1)) ?? null;

  // Округляем до целых минут: иначе в UI попадает «через 4 год 30.13751666666667 хв».
  const nextInMinutes = nextOff && nowMinutes != null ? Math.max(0, Math.round(minutesOfDay(nextOff.startsAt, date) - nowMinutes)) : null;
  const backInMinutes =
    isOff && current && nowMinutes != null ? Math.max(0, Math.round(minutesOfDay(current.endsAt, date) - nowMinutes)) : null;

  return {
    nowMinutes,
    current,
    isOff,
    offEndsAt: isOff && current ? current.endsAt : null,
    nextStartsAt: nextOff?.startsAt ?? null,
    nextInMinutes,
    backInMinutes,
    offMinutes,
  };
}

export interface SlotProgress {
  /** Доля пройденного слота, 0..100. */
  percent: number;
  /** Минут с начала слота. */
  elapsedMinutes: number;
  /** Минут до конца слота. */
  remainingMinutes: number;
}

/**
 * Прогресс текущего слота суток — основа волнистой полосы M3 в Hero.
 *
 * Слот — это «отключение» (пока света нет) либо окно «світло є»: от конца предыдущего
 * отключения до начала следующего. Второй случай нужен, чтобы полоса не исчезала, когда всё
 * хорошо: человек видит, сколько ещё осталось спокойного времени.
 *
 * Возвращает null, если считать нечего: графика нет, показаны не сегодняшние сутки или
 * отключений впереди больше не будет (тогда честнее не рисовать процент, чем выдумать слот).
 */
export function slotProgress(
  intervals: ScheduleIntervalUtc[],
  date: string,
  now: Date = new Date(),
): SlotProgress | null {
  const summary = scheduleWindow(intervals, date, now);
  const nowMinutes = summary.nowMinutes;
  if (nowMinutes == null || intervals.length === 0) return null;

  if (summary.isOff && summary.current) {
    return buildSlot(
      minutesOfDay(summary.current.startsAt, date),
      minutesOfDay(summary.current.endsAt, date),
      nowMinutes,
    );
  }

  if (!summary.nextStartsAt) return null;
  const nextStart = minutesOfDay(summary.nextStartsAt, date);
  // Начало окна «світло є» — конец последнего закончившегося интервала, либо 00:00.
  const previousEnds = intervals
    .map((interval) => minutesOfDay(interval.endsAt, date))
    .filter((end) => end <= nowMinutes);
  const from = previousEnds.length > 0 ? Math.max(...previousEnds) : 0;
  return buildSlot(from, nextStart, nowMinutes);
}

function buildSlot(from: number, to: number, nowMinutes: number): SlotProgress | null {
  if (to <= from) return null;
  const point = Math.max(from, Math.min(to, nowMinutes));
  return {
    percent: Math.round(((point - from) / (to - from)) * 100),
    elapsedMinutes: Math.round(point - from),
    remainingMinutes: Math.round(to - point),
  };
}
