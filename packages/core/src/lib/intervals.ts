/** Интервал в локальном часовом времени (Europe/Kyiv), минуты от полуночи. */
export interface MinuteInterval {
  startMin: number;
  endMin: number;
}

interface RawInterval {
  startsAt: string;
  endsAt: string;
}

/**
 * Минуты от полуночи по Europe/Kyiv для ISO-строки.
 *
 * Считаем через Intl, а не через `new Date().getHours()`: браузер может быть в любом
 * часовом поясе, а графики отключений всегда читаются по киевскому времени.
 */
function kyivMinutes(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour % 24) * 60 + minute;
}

/**
 * Склеивает смежные и пересекающиеся интервалы в непрерывные окна.
 *
 * Зачем: источники графиков отдают получасовые слоты (18:00–18:30, 18:30–19:00, …).
 * Если рисовать их как есть, человек получает 30 отдельных плашек и вынужден
 * складывать их в уме в одно окно. После склейки шестичасовой перебораз обходится
 * одним отрезком `18:00 – 00:00`.
 *
 * Интервал, переходящий через полночь (`23:30 → 00:30`), разбивается на два дневных
 * окна, потому что шкала всегда показывает ровно 24 часа.
 */
export function mergeIntervals(intervals: RawInterval[]): MinuteInterval[] {
  const windows: MinuteInterval[] = [];

  for (const interval of intervals) {
    const from = kyivMinutes(interval.startsAt);
    const to = kyivMinutes(interval.endsAt);
    if (from === null || to === null) continue;

    if (to > from) {
      windows.push({ startMin: from, endMin: to });
    } else if (to === from) {
      // Вырожденный интервал: у источника не нашлось конца слота. Раньше он попадал в
      // график как карточка «00:00 – 00:00 · 0 хв», поэтому выбрасываем его целиком.
      continue;
    } else {
      // Переход через полночь: отрезок до утра и отрезок после полуночи.
      // Второй кусок добавляем только если он не пустой: при `23:30 → 00:00` хвост равен
      // нулю, и без проверки он превращался в фантом `00:00 – 00:00` на шкале.
      windows.push({ startMin: from, endMin: 24 * 60 });
      if (to > 0) windows.push({ startMin: 0, endMin: to });
    }
  }

  windows.sort((a, b) => a.startMin - b.startMin);

  // Страховка от нулевых окон: любое окно без длины нельзя ни нарисовать, ни показать
  // в списке — оно всегда выглядит как ошибка, а не как отключение.
  const nonEmpty = windows.filter((window) => window.endMin > window.startMin);

  const merged: MinuteInterval[] = [];
  for (const window of nonEmpty) {
    const last = merged[merged.length - 1];
    if (last && window.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, window.endMin);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/**
 * Смещение Europe/Kyiv в минутах на момент `at`.
 *
 * Через Intl, а не через фиксированный «+2/+3»: зимой Киев на UTC+2, летом на UTC+3, и
 * жёсткая константа сдвигала бы график на час в половине года.
 */
function kyivOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const value = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const asUtc = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * Склеенные интервалы обратно в ISO-строки — чтобы скормить их `Timeline24h`.
 *
 * Смещение берётся в два прохода: первый даёт приблизительный момент, второй — точный
 * для найденного момента. Одного прохода не хватает на границе перехода UTC+2 ↔ UTC+3.
 */
export function toIsoIntervals(
  windows: MinuteInterval[],
  date: string,
): Array<{ startsAt: string; endsAt: string; stateCode: 1 | 2 | 3; stateName: string; stateColor: string }> {
  const wallToIso = (minutes: number): string => {
    const naive = Date.parse(
      `${date}T${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00Z`,
    );
    const firstGuess = new Date(naive - kyivOffsetMinutes(new Date(naive)) * 60_000);
    return new Date(naive - kyivOffsetMinutes(firstGuess) * 60_000).toISOString();
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