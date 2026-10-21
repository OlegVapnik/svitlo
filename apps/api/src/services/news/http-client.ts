/**
 * HTTP-клієнт для безпечного завантаження публічних стрічок новин та Telegram-прев'ю.
 *
 * Особливості:
 * - фіксований таймаут (15 с);
 * - браузерний User-Agent;
 * - підтримка інжекції fetchImpl для ізольованого тестування без звернень до мережі;
 * - структуровані помилки без витоку секретів або персональних даних.
 */
import { env } from '../../config.js';

export const NEWS_HTTP_TIMEOUT_MS = 15_000;
export const NEWS_HTTP_RETRY_DELAY_MS = 1_200;

/**
 * Telegram віддає браузерну версію `/s/<канал>` лише схожим на браузер клієнтам.
 * Зі «службовим» UA той самий URL періодично рветься на рівні з'єднання (`fetch failed`,
 * без HTTP-коду) — це анти-бот, а не «немає новин». Обхід дозволений (AGENTS.md, правило 6).
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Вибір UA за джерелом: t.me — браузерний, решта — службовий (з якого просить оператор). */
export function newsUserAgentFor(url: string): string {
  try {
    if (new URL(url).hostname.endsWith('t.me')) return BROWSER_USER_AGENT;
  } catch {
    // Некоректний URL віддасть помилку на fetch — тут просто службовий UA.
  }
  return env.CHERNIHIV_USER_AGENT || env.PARSER_USER_AGENT;
}

export class NewsFetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly sourceUrl?: string,
  ) {
    super(message);
    this.name = 'NewsFetchError';
  }
}

export async function fetchNewsSourceRaw(
  url: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? NEWS_HTTP_TIMEOUT_MS;
  const headers = {
    accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8',
    'user-agent': newsUserAgentFor(url),
  };

  // Дві спроби: обрив з'єднання (не HTTP-код) буває короткочасним — один повтор дешевший,
  // ніж втрачена доба новин (наступний цикл збору за розкладом — через 15–30 хв).
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        // HTTP-код — повтор не допоможе: це реальна відмова джерела, її треба бачити в звіті.
        throw new NewsFetchError(
          `Джерело новин повернуло HTTP ${response.status} (${url})`,
          response.status,
          url,
        );
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (error instanceof NewsFetchError) throw error;
      if (attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, NEWS_HTTP_RETRY_DELAY_MS));
    }
  }

  throw new NewsFetchError(
    `Джерело новин недоступне (${url}): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    undefined,
    url,
  );
}
