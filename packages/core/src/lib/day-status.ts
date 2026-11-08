import { SOON_MINUTES } from '@svitlo/domain';

/**
 * Статус доби за графіком групи — реекспорт домену.
 *
 * Правило живе в `@svitlo/domain` (`publication.ts`), бо його однаково застосовують веб,
 * застосунок і Worker: «порожній графік» і «оператор підтвердив добу без відключень» — це різні
 * стани, і зелений без даних заборонений. Копія в клієнті рано чи пізно розійшлася б із
 * серверною — саме тому реалізацію прибрано звідси.
 */
export { SOON_MINUTES, dayPowerState, isSchedulePublished } from '@svitlo/domain';

export type { DayPowerState, DayStatus, DayScheduleLike } from '@svitlo/domain';

/** Тон волнистої смуги: форма й колір — частина відповіді «світло є?», а не декор. */
export type WaveTone = 'on' | 'warning' | 'off' | 'unknown';

/**
 * Стан екрана → тон смуги прогресу.
 *
 * Веб має `soon`, застосунок — `warning`; обидва означають «світло ще є, але скоро вимкнуть».
 * Мапінг живе тут, а не в компонентах: інакше `allClear` на одній платформі зеленів, а на
 * іншій ставав сірим «немає даних».
 */
export function waveToneOf(state: string): WaveTone {
  if (state === 'off') return 'off';
  if (state === 'soon' || state === 'warning') return 'warning';
  if (state === 'on' || state === 'allClear') return 'on';
  return 'unknown';
}

/**
 * Чи настане відключення протягом порогу «скоро».
 *
 * `SOON_MINUTES` — доменна константа (60 хв). Застосунок раніше мав власні 30 хв у двох місцях,
 * тому герой і «Монітор» по-різному вирішували, що показувати жовтим.
 */
export function isSoonMinutes(
  nextInMinutes: number | null | undefined,
  threshold: number = SOON_MINUTES,
): boolean {
  if (nextInMinutes == null || !Number.isFinite(nextInMinutes) || nextInMinutes < 0) return false;
  return nextInMinutes <= threshold;
}

/** Семантический вид подписи под статусом: текст выбирает компонент, правило — здесь. */
export type HeroNotice =
  | 'loading'
  | 'error'
  | 'unpublished'
  | 'allClear'
  | 'off'
  | 'upcoming'
  | 'finishedToday';

/**
 * Что написать под бейджем героя.
 *
 * Отдельный вид `finishedToday` — ответ на прод-баг: график опубліковано, отключение 12:00–14:00
 * уже прошло, будущих нет. Раньше UI видел «нет `nextStartsAt`» и падал в `unpublished`, хотя
 * рядом на шкале висели те самые два часа. «Нет будущих» и «нет графика» — разные факты.
 *
 * `hasIntervals` важнее `state`: наличие слотов — доказательство публикации (см.
 * `isSchedulePublished` в домене).
 */
export function heroNotice(input: {
  loading?: boolean;
  error?: boolean;
  state: string;
  hasIntervals: boolean;
  summary?: { isOff?: boolean; nextStartsAt?: string | null } | null;
}): HeroNotice {
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  if (input.state === 'allClear') return 'allClear';
  if (input.state === 'unknown' || !input.hasIntervals) return 'unpublished';
  if (input.state === 'off') return 'off';
  if (input.summary?.nextStartsAt) return 'upcoming';
  return 'finishedToday';
}
