/**
 * Дата, про яку йдеться в пості оператора в Telegram.
 *
 * Оператори пишуть «на 9 жовтня», «сьогодні», «завтра» — рідко з роком. Правило «який рік
 * має на увазі автор» чисте (тільки текст і дата публікації), тому воно тут, а не в парсері
 * конкретного каналу: раніше ця функція жила в `cf-worker/src/telegram-schedule.ts` і була
 * недоступна нікому іншому.
 */
import { kyivDateKeyFromMs, shiftYmd } from './kyiv-time.ts';

/** Місяці в називному відмінку — так їх пишуть оператори. */
const KYIV_MONTHS: Record<string, number> = {
  січня: 1, лютого: 2, березня: 3, квітня: 4, травня: 5, червня: 6,
  липня: 7, серпня: 8, вересня: 9, жовтня: 10, листопада: 11, грудня: 12,
};

const DATE_RE = /(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/iu;

/**
 * Дата, про яку йдеться в пості. Пріоритет: «на 9 жовтня» → «сьогодні»/«завтра» → дата публікації.
 *
 * Рік беремо з дати публікації; якщо вийшло більш ніж на тиждень раніше за публікацію — це
 * перехід через Новий рік, отже рік наступний.
 */
export function resolveScheduleDate(text: string, publishedAt: Date): string {
  const published = kyivDateKeyFromMs(publishedAt.getTime());
  if (/(?:^|[^\p{L}])завтра(?!\p{L})/iu.test(text)) return shiftYmd(published, 1);
  if (/(?:^|[^\p{L}])сьогодні(?!\p{L})/iu.test(text)) return published;
  const match = DATE_RE.exec(text);
  if (!match) return published;
  const day = Number(match[1]);
  const month = KYIV_MONTHS[match[2]!.toLowerCase()] ?? 0;
  if (!day || !month) return published;
  const year = Number(published.slice(0, 4));
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return candidate < shiftYmd(published, -7) ? `${year + 1}-${candidate.slice(5)}` : candidate;
}
