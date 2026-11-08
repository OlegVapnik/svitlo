import { format, formatDistanceToNow, isToday as checkIsToday, isTomorrow as checkIsTomorrow } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { uk } from 'date-fns/locale';

export const KYIV_TZ = 'Europe/Kyiv';

/** Київська календарна дата сьогодні — реекспорт доменного правила. */
export { kyivToday } from '@svitlo/domain';

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

/** Только дата в киевском поясе («17 жовт. 2026») — для шапки «Що нового». */
export function formatDate(iso: string): string {
  if (!isValidIso(iso)) return INVALID_DATE_PLACEHOLDER;
  return formatInTimeZone(new Date(iso), KYIV_TZ, 'd MMM yyyy', { locale: uk });
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

/**
 * Момент в киевском поясе для подписи «Перевірено о 23:40»: сегодня — только время, иначе дата.
 *
 * Отдельно от `formatDateTime`, потому что здесь важна не календарная дата, а «давно ли это было»:
 * на экране новостей полная дата опроса занимает всю строку и всё равно не отвечает на вопрос,
 * двигается ли сбор прямо сейчас.
 */
export function formatKyivMoment(iso: string, now: Date = new Date()): string {
  if (!isValidIso(iso)) return INVALID_DATE_PLACEHOLDER;
  const at = new Date(iso);
  const sameDay = formatInTimeZone(now, KYIV_TZ, 'yyyy-MM-dd') === formatInTimeZone(at, KYIV_TZ, 'yyyy-MM-dd');
  if (sameDay) return `о ${formatInTimeZone(at, KYIV_TZ, 'HH:mm')}`;
  return formatInTimeZone(at, KYIV_TZ, 'd MMM, HH:mm', { locale: uk });
}

/**
 * Самый свежий момент из набора ISO-строк: `null`, если валидных нет.
 *
 * Нужен строке источников: у каждого канала своя метка, а человеку нужна одна — «когда сбор
 * последний раз смотрел хоть куда-то».
 */
export function latestIso(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (!value || !Number.isFinite(Date.parse(value))) continue;
    if (!latest || Date.parse(value) > Date.parse(latest)) latest = value;
  }
  return latest;
}

export function formatRelative(iso: string): string {
  if (!isValidIso(iso)) return INVALID_DATE_PLACEHOLDER;
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: uk });
}

/**
 * Минуты → «02» и «14» для крупного обратного отсчёта. null — отсчитывать нечего.
 *
 * Логика была локальной в `HeroStatus` web; теперь одна на оба клиента, чтобы таймер и
 * подписи не расходились в округлении.
 */
export function splitClockMinutes(
  minutes: number | null | undefined,
): { hours: string; minutes: string } | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const total = Math.round(minutes);
  return {
    hours: String(Math.floor(total / 60)).padStart(2, '0'),
    minutes: String(total % 60).padStart(2, '0'),
  };
}

/**
 * Календарная дата `YYYY-MM-DD` → «ДД.ММ» для узких строк списка областей.
 *
 * Не через `Date`: строка уже киевская календарная дата, и любой парсинг в другой зоне
 * может сдвинуть её на день. Некорректное значение → пустая строка (в UI это «нет даты»).
 */
export function formatDayMonth(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return '';
  return `${match[3]}.${match[2]}`;
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
/**
 * Заголовок секции по киевской дате: «Сьогодні, 19 жовтня» / «Завтра, 20 жовтня» / «19 жовтня».
 *
 * Дата печатается один раз на секцию, а не в каждой карточке. `now` передаётся явно, чтобы
 * заголовок не «прыгал» между рендерами и тестами.
 */
export function formatDayHeading(ymd: string, now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat('uk-UA', {
    timeZone: KYIV_TZ,
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${ymd}T12:00:00+03:00`));
  const key = (date: Date): string => formatInTimeZone(date, KYIV_TZ, 'yyyy-MM-dd');
  const todayKey = key(now);
  const tomorrowKey = key(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (ymd === todayKey) return `Сьогодні, ${day}`;
  if (ymd === tomorrowKey) return `Завтра, ${day}`;
  return day;
}
