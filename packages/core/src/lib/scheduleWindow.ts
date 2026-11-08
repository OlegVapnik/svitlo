/**
 * Вікно графіка за київськими сутками — реекспорт домену.
 *
 * Сама математика (переведення ISO в хвилини доби, «що зараз», «коли наступне відключення»,
 * прогрес слота) переїхала в `@svitlo/domain` (`publication.ts`): те саме рахує Worker у `/sync`
 * і застосунок, і розходитися їм не можна. Тут лишилися тільки форматтери — це презентація,
 * домену вона не потрібна.
 *
 * Раніше кожен файл мав власний `Intl`-розрахунок зсуву Києва; тепер зсув береться з
 * `kyivOffsetMinutesAt` домену, тобто з тієї ж арифметики, що й у Worker.
 */
export {
  OFF_STATE_CODE,
  kyivOffset,
  minutesOfDay,
  scheduleWindow,
  slotProgress,
} from '@svitlo/domain';

export type {
  ScheduleIntervalLike,
  ScheduleIntervalLike as ScheduleInterval,
  ScheduleWindow,
  SlotProgress,
} from '@svitlo/domain';

/** Тривалість по-українськи: «45 хв», «1 год», «1 год 20 хв» (без «0 год 45 хв»). */
export function formatMinutesUk(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  if (minutes < 60) return `${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} год` : `${hours} год ${rest} хв`;
}

/** Минута суток → «06:00» (підписи в смузі доби й у підказках). */
export function minutesToHm(minutes: number): string {
  const value = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/**
 * Уникальные состояния суток для легенды: «Світло є» печатается один раз, а не по разу на
 * каждый интервал. Порядок — порядок первого появления в графике.
 */
export function uniqueIntervalStates(
  intervals: ReadonlyArray<{ stateName: string; stateCode: number }>,
): Array<{ name: string; code: number }> {
  const seen = new Set<string>();
  const result: Array<{ name: string; code: number }> = [];
  for (const interval of intervals) {
    const key = `${interval.stateCode}:${interval.stateName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name: interval.stateName, code: interval.stateCode });
  }
  return result;
}
