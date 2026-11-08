/**
 * Різниця між двома зрізами графіка відключень за добу.
 *
 * Потрібна банера «Що змінилось у графіку»: людина бачить не абсолютний графік, а саме те,
 * що оператор переписав відтоді, як вона востаннє дивилася екран. Порівнюємо не сирі слоти,
 * а склеєні вікна (`mergeIntervals`): джерело може розбити те саме відключення на півгодини
 * інакше, і без склейки кожен перезапис виглядав би як зміна.
 *
 * Облік хвилин — по множині покриття, а не по довжині масиву: частковий зсув вікна
 * (`18:00–20:00` → `19:00–21:00`) дає і додану, і відняту хвилину одночасно, і рахувати їх
 * треба без подвійного обліку перетину.
 */
import { mergeIntervals, mergeMinuteRanges, type IsoInterval, type MinuteInterval } from './daily-intervals.ts';

/** Конкретне вікно змін у київському часі: і хвилини від півночі, і готова підпис. */
export interface TimeRange {
  startMin: number;
  endMin: number;
  /** `HH:MM` по Києву. */
  start: string;
  /** `HH:MM` по Києву. */
  end: string;
}

/** Результат порівняння двох зрізів графіка. */
export interface ScheduleDiff {
  /** Хвилини, які раніше були зі світлом, а тепер без нього. */
  addedMinutes: number;
  /** Хвилини, які раніше були без світла, а тепер зі світлом. */
  removedMinutes: number;
  /** Які саме години додалися (склеєні вікна, без перетинів). */
  addedRanges: TimeRange[];
  /** Які саме години скасували (склеєні вікна, без перетинів). */
  removedRanges: TimeRange[];
  /** Чи є що показувати людині (порожній `prev` — перший запуск, а не зміна). */
  changed: boolean;
  /** Готова українська фраза; `null`, коли змін немає. */
  summary: string | null;
  /** Те саме, що `summary`, але з явною назвою для нових споживачів. */
  summaryUk: string | null;
}

/**
 * Порівнює два зрізи графіка за одну добу.
 *
 * `prev` — те, що бачили минулого разу; `next` — свіжий зріз. Порожній `prev` за замовчуванням
 * означає перший запуск за добу: банер тоді не показуємо, навіть якщо відключення вже є, —
 * інакше «щось змінилось» з'являлося б у кожного новачка.
 *
 * `emptyPrevIsFirstRun: false` потрібен сховищу зрізів: там порожній масив може бути цілком
 * реальним «оператор опублікував добу без відключень», і поява годин після нього — справжня
 * зміна, а не перший запуск.
 */
export function diffScheduleIntervals(
  prevIntervals: readonly IsoInterval[],
  nextIntervals: readonly IsoInterval[],
  options: { emptyPrevIsFirstRun?: boolean; nowMinutesOfDay?: number } = {},
): ScheduleDiff {
  // `mergeIntervals` приймає масив, тому копіюємо: readonly-вхід не повинен залежати від мутацій.
  const prev = mergeIntervals([...prevIntervals]);
  const next = mergeIntervals([...nextIntervals]);

  const now =
    typeof options.nowMinutesOfDay === 'number' && Number.isFinite(options.nowMinutesOfDay)
      ? Math.max(0, Math.min(1440, options.nowMinutesOfDay))
      : null;

  const added = uncoveredRanges(next, prev);
  const removed = uncoveredRanges(prev, next);
  // Минулі години не є зміною: джерело могло прислати лише залишок доби, і без відсікання
  // о 20:21 зникав би слот 15:00–18:00 — начебто його щойно скасували.
  const addedFuture = now === null ? added : trimPastRanges(added, now);
  const removedFuture = now === null ? removed : trimPastRanges(removed, now);
  let addedMinutes = totalMinutes(addedFuture);
  let removedMinutes = totalMinutes(removedFuture);
  const insignificant = now !== null && addedMinutes < 30 && removedMinutes < 30;
  if (insignificant) {
    addedMinutes = 0;
    removedMinutes = 0;
  }
  const firstRun = prev.length === 0 && (options.emptyPrevIsFirstRun ?? true);
  const changed = !insignificant && !firstRun && (addedMinutes > 0 || removedMinutes > 0);
  // На першому запуску `addedMinutes` може бути > 0 (графік уже є), але це не «зміна»:
  // діапазони показуємо лише тоді, коли є що порівнювати з попереднім зрізом.
  const addedRanges = changed ? toTimeRanges(addedFuture) : [];
  const removedRanges = changed ? toTimeRanges(removedFuture) : [];
  const summary = changed ? buildSummary(addedMinutes, removedMinutes, addedRanges, removedRanges) : null;

  return {
    addedMinutes,
    removedMinutes,
    addedRanges,
    removedRanges,
    changed,
    summary,
    summaryUk: summary,
  };
}

/**
 * Шматки `ranges`, яких немає в `covered`.
 *
 * Обидва масиви відсортовані й не перетинаються всередині себе (результат `mergeMinuteRanges`),
 * тому достатньо одного проходу по кожному діапазону. Перетин не додається двічі: курсор
 * пересувається до кінця вже врахованого вікна.
 */
function uncoveredRanges(ranges: MinuteInterval[], covered: MinuteInterval[]): MinuteInterval[] {
  const gaps: MinuteInterval[] = [];
  for (const range of ranges) {
    let cursor = range.startMin;
    for (const cover of covered) {
      if (cover.endMin <= cursor) continue;
      if (cover.startMin >= range.endMin) break;
      if (cover.startMin > cursor) gaps.push({ startMin: cursor, endMin: Math.min(cover.startMin, range.endMin) });
      cursor = Math.max(cursor, cover.endMin);
      if (cursor >= range.endMin) break;
    }
    if (cursor < range.endMin) gaps.push({ startMin: cursor, endMin: range.endMin });
  }
  // Сусідні шматки можуть з'явитися після кількох перетинів — склеюємо, щоб не показувати
  // «18:00–18:30, 18:30–19:00» замість одного вікна.
  return mergeMinuteRanges(gaps);
}

function totalMinutes(ranges: readonly MinuteInterval[]): number {
  return ranges.reduce((sum, range) => sum + (range.endMin - range.startMin), 0);
}

/**
 * Лишає тільки майбутню частину вікон.
 *
 * Вікно, яке вже завершилося (з запасом 5 хв на округлення), зникає повністю: саме воно й
 * давало фейкове «скасовано 15:00–18:00» о пів на дев'яту вечора. Вікно, що триває, обрізається
 * до поточної хвилини — людині важливо, що буде далі, а не скільки вже минуло.
 */
function trimPastRanges(ranges: readonly MinuteInterval[], nowMinutesOfDay: number): MinuteInterval[] {
  const trimmed: MinuteInterval[] = [];
  for (const range of ranges) {
    if (range.endMin <= nowMinutesOfDay + 5) continue;
    const startMin = Math.max(range.startMin, nowMinutesOfDay);
    if (startMin < range.endMin) trimmed.push({ startMin, endMin: range.endMin });
  }
  return mergeMinuteRanges(trimmed);
}

/** `HH:MM` для хвилин від київської півночі. 1440 — це кінець доби, показуємо як `00:00`. */
export function clockLabel(minuteOfDay: number): string {
  const normalized = ((minuteOfDay % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function toTimeRanges(ranges: readonly MinuteInterval[]): TimeRange[] {
  return ranges.map((range) => ({
    startMin: range.startMin,
    endMin: range.endMin,
    start: clockLabel(range.startMin),
    end: clockLabel(range.endMin),
  }));
}

/** «1 год 30 хв», «2 год», «45 хв» — тривалість словами, як у решті інтерфейсу. */
function formatDurationUk(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} хв`;
  if (rest === 0) return `${hours} год`;
  return `${hours} год ${rest} хв`;
}

function rangesLabel(ranges: readonly TimeRange[]): string {
  return ranges.map((range) => `${range.start}–${range.end}`).join(', ');
}

/**
 * Коротка фраза для банера. Емодзі додає UI: домен лишається текстовим, щоб ту саму фразу
 * можна було надрукувати в сповіщенні, шарінг-картці чи консолі.
 */
function buildSummary(
  addedMinutes: number,
  removedMinutes: number,
  addedRanges: readonly TimeRange[],
  removedRanges: readonly TimeRange[],
): string {
  const addedLabel = rangesLabel(addedRanges);
  const removedLabel = rangesLabel(removedRanges);
  if (addedMinutes > 0 && removedMinutes > 0) {
    return `Графік змінився: +${formatDurationUk(addedMinutes)}${
      addedLabel ? ` (${addedLabel})` : ''
    }, −${formatDurationUk(removedMinutes)}${removedLabel ? ` (${removedLabel})` : ''}`;
  }
  if (addedMinutes > 0) {
    return `Графік оновлено: +${formatDurationUk(addedMinutes)} без світла${
      addedLabel ? ` (додано ${addedLabel})` : ''
    }`;
  }
  return `Відключення зменшено на ${formatDurationUk(removedMinutes)}${
    removedLabel ? ` (скасовано ${removedLabel})` : ''
  }`;
}
