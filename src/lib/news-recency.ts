/**
 * Свіжість новин у застосунку.
 *
 * Оператор публікує кілька постів на день, і стрічка з 50 елементів за тиждень
 * перетворюється на архів: людина гортає застарілі відключення, щоб дійти до
 * сьогоднішніх. Тримаємо лише останні дні — решта вже не має практичної цінності.
 *
 * Записи без дати не відкидаємо: краще показати пост без часу, ніж загубити його.
 */
export const NEWS_MAX_AGE_DAYS = 4;

const DAY_MS = 86_400_000;

export function filterRecentNews<T extends { publishedAt: string | null }>(
  items: readonly T[],
  now: Date = new Date(),
  days: number = NEWS_MAX_AGE_DAYS,
): T[] {
  const cutoff = now.getTime() - days * DAY_MS;
  return items.filter((item) => {
    if (!item.publishedAt) return true;
    const timestamp = Date.parse(item.publishedAt);
    if (Number.isNaN(timestamp)) return true;
    return timestamp >= cutoff;
  });
}
