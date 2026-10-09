import { format, formatDistanceToNow, isToday as checkIsToday, isTomorrow as checkIsTomorrow } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { uk } from 'date-fns/locale';

export const KYIV_TZ = 'Europe/Kyiv';

export function formatDateTime(iso: string): string {
  return formatInTimeZone(new Date(iso), KYIV_TZ, "d MMM yyyy, HH:mm", { locale: uk });
}

export function formatTimeRange(start: string, end: string): string {
  const t1 = formatInTimeZone(new Date(start), KYIV_TZ, 'HH:mm');
  const t2 = formatInTimeZone(new Date(end), KYIV_TZ, 'HH:mm');
  return `${t1} – ${t2}`;
}

export function formatRelative(iso: string): string {
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