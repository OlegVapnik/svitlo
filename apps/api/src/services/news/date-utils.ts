/**
 * Робота з датами та часом відповідно до skills/kyiv-time.
 *
 * Правила:
 * 1. Зберігаємо й транслюємо виключно UTC ISO (timestamptz у БД).
 * 2. Календарні дні рахуються виключно в таймзоні Europe/Kyiv.
 * 3. Жодних ручних зсувів або додавання 24*3600*1000 мс.
 */

export const KYIV_TIMEZONE = 'Europe/Kyiv';

const kyivDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: KYIV_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Повертає календарний день у Києві у форматі YYYY-MM-DD для заданого моменту часу.
 */
export function getKyivDateString(date: Date = new Date()): string {
  return kyivDateFormatter.format(date);
}

/**
 * Перетворює рядок дати будь-якого стандартного формату (RFC 822/2822, ISO 8601) на валідний UTC ISO-рядок.
 * Якщо рядок не вдалося розібрати — повертає null.
 */
export function parseDateToUtcIso(rawDate: unknown): string | null {
  if (!rawDate) return null;
  const str = String(rawDate).trim();
  if (!str) return null;

  const parsedMs = Date.parse(str);
  if (!Number.isFinite(parsedMs)) return null;

  return new Date(parsedMs).toISOString();
}

/**
 * Перевіряє, чи дата публікації (UTC ISO рядок або Date) не раніше за задану дату sinceDate (YYYY-MM-DD у київському часі).
 */
export function isPublishedOnOrAfterKyivDate(publishedAt: string | Date | null, sinceYmd: string): boolean {
  if (!publishedAt) return false;
  const dateObj = typeof publishedAt === 'string' ? new Date(publishedAt) : publishedAt;
  if (!Number.isFinite(dateObj.getTime())) return false;

  const publishedKyivDate = getKyivDateString(dateObj);
  return publishedKyivDate >= sinceYmd;
}
