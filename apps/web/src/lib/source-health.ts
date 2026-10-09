import type { StatusResponse } from '@energy-monitor/shared';

/**
 * Источник данных глазами пользователя. Три состояния, потому что и действий три:
 *   ok      — данные свежие, ничего делать не надо;
 *   stale   — показано последнее известное, нужно предупредить (данные не выдаём за живые);
 *   problem — источник отказал (например, оператор вернул 403/429), видна причина и пауза.
 *
 * Правила держим в чистой функции: их проверяет unit-тест, а не глазами по вёрстке.
 */
export type SourceSeverity = 'ok' | 'stale' | 'problem';

export function sourceSeverity(status: StatusResponse | undefined): SourceSeverity {
  if (!status) return 'ok';
  if (status.lastError) return 'problem';
  // нет отметки обновления вообще — данные показывать как «свежие» нельзя
  if (status.dataStale || !status.lastUpdatedAt) return 'stale';
  return 'ok';
}
