import { format, formatDistanceToNow, isToday as checkIsToday, isTomorrow as checkIsTomorrow } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { uk } from 'date-fns/locale';

export const KYIV_TZ = 'Europe/Kyiv';

/**
 * Проверяет дату ДО форматирования.
 *
 * Зачем: date-fns бросает «Invalid time value» на мусорной строке и на undefined, и это
 * исключение умирает на белом экране. Так уже случилось дважды — сначала воркер отдал
 * `startsAt` вместо `startedAt`, потом не хватило `localTimeFrom`. Один неверный ключ в
 * ответе API не должен ронять страницу, поэтому проверка тут, а не только в бэкенде.
 */
export function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

/** Заглушка вместо даты: видно, что поле не пришло, и страница остаётся живой. */
export const INVALID_DATE_PLACEHOLDER = '—';

export function formatDateTime(iso: string): string {
  if (!isValidIso(iso)) return INVALID_DATE_PLACEHOLDER;
  return formatInTimeZone(new Date(iso), KYIV_TZ, "d MMM yyyy, HH:mm", { locale: uk });
}

export function formatTimeRange(start: string, end: string): string {
  if (!isValidIso(start) || !isValidIso(end)) return INVALID_DATE_PLACEHOLDER;
  const t1 = formatInTimeZone(new Date(start), KYIV_TZ, 'HH:mm');
  const t2 = formatInTimeZone(new Date(end), KYIV_TZ, 'HH:mm');
  return `${t1} – ${t2}`;
}

/**
 * Только время в киевском поясе («14:00»).
 *
 * Отдельно от formatDateTime: в текстах уведомлений и подписях к строке расписания дата лишняя
 * и только удлиняет строку — «Світло зникне за 30 хв, початок о 14:00» читается сразу.
 */
export function formatKyivTime(iso: string): string {
  if (!isValidIso(iso)) return INVALID_DATE_PLACEHOLDER;
  return formatInTimeZone(new Date(iso), KYIV_TZ, 'HH:mm');
}

export function formatRelative(iso: string): string {
  if (!isValidIso(iso)) return INVALID_DATE_PLACEHOLDER;
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: uk });
}

export function isActive(start: string, end: string): boolean {
  const now = new Date();
  return new Date(start) <= now && new Date(end) >= now;
}

export function isToday(iso: string): boolean {
  return checkIsToday(new Date(iso));
}

export function isTomorrow(iso: string): boolean {
  return checkIsTomorrow(new Date(iso));
}