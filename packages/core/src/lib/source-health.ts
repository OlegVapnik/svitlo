import type { StatusResponse } from '@svitlo/shared';

/**
 * Источник данных глазами пользователя. Три состояния, потому что и действий три:
 *   ok      — данные свежие, ничего делать не надо;
 *   stale   — показано последнее известное, нужно предупредить (данные не выдаём за живые);
 *   problem — источник отказал (например, оператор вернул 403/429), видна причина и пауза.
 *
 * Правила держим в чистой функции: их проверяет unit-тест, а не глазами по вёрстке.
 */
export type SourceSeverity = 'ok' | 'stale' | 'problem';

/**
 * Порог устаревания на клиенте — 75 минут, а не «флаг с сервера».
 *
 * Крон воркера обходит зеркала раз в 20 минут и пишет `lastUpdatedAt`; путь обхода может
 * занять ещё несколько минут. Серверный `dataStale` считается по своим часам (в API — 2 часа,
 * у старого воркера — меньше), и на «Оновлено 29 хвилин тому» плашка «Застарілі дані» пугала
 * людей при живом расписании. Поэтому решает возраст отметки, а флаг сервера здесь не главный:
 * если данные моложе 75 минут, показываем их как свежие.
 */
export const STALE_AFTER_MINUTES = 75;

export function sourceSeverity(
  status: StatusResponse | undefined,
  now: Date = new Date(),
): SourceSeverity {
  if (!status) return 'ok';
  if (status.lastError) return 'problem';
  // нет отметки обновления вообще — данные показывать как «свежие» нельзя
  if (!status.lastUpdatedAt) return 'stale';

  const updatedAt = Date.parse(status.lastUpdatedAt);
  if (!Number.isFinite(updatedAt)) return 'stale';

  const ageMinutes = (now.getTime() - updatedAt) / 60_000;
  return ageMinutes > STALE_AFTER_MINUTES ? 'stale' : 'ok';
}
