import {
  operatorScheduleLiveSchema,
  type OperatorScheduleResponse,
  type OperatorStateCode,
} from '@svitlo/shared';
import { env } from '../config.js';

/**
 * Публічний метод оператора `POST /api/info_schedule {queue, curr_dt}`
 * (піддомен interruptions.energy.cn.ua).
 *
 * Капчі тут немає й персональних даних немає (у запиті лише номер черги й дата), але **даних теж
 * немає**: перевірено 10.10.2026 дванадцятьма запитами з контейнера (черги 2/2, 2, 1) — завжди
 * `200 {"status":"ok","aData":null}`. Це заглушка оператора.
 * Справжній погодинний ГПВ віддає `POST /api/info_schedule_part`, і він за Cloudflare Turnstile
 * (`400 {"error":"No captcha"}` без токена); ми його НЕ обходимо (AGENTS.md, розділ
 * «Operator schedule and anti-bot boundary»).
 *
 * Тому цей сервіс — лише безпечний контракт «спитати публічний метод»: він чесно повертає 0 слотів,
 * а не вигадує дані. Формат запиту при цьому підтверджено з DevTools оператора —
 * `{queue: "2/2", curr_dt: "2026-10-10"}`, тобто рівно те, що ми надсилаємо.
 * Повідомлення про помилки навмисно короткі: тіло відповіді оператора не логуємо і не повертаємо.
 */
export class OperatorScheduleFetchError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
    this.name = 'OperatorScheduleFetchError';
  }
}

/**
 * Приводить живу відповідь до типу імпорту. `aData: null` — не збій: оператор так каже «на цю
 * чергу/дату погодинного ГПВ не публікували». Перетворюємо на порожній масив, щоб імпорт
 * записав 0 слотів (і оновив метадані), а не впав на валідації схеми.
 */
export function normalizeOperatorSchedulePayload(raw: unknown): OperatorScheduleResponse {
  const parsed = operatorScheduleLiveSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OperatorScheduleFetchError('Оператор повернув неочікуваний формат графіка');
  }
  return {
    status: parsed.data.status,
    aState: parsed.data.aState,
    aData: (parsed.data.aData ?? []).map((slot) => ({
      time_from: slot.time_from,
      time_to: slot.time_to,
      queue: Number(slot.queue) as OperatorStateCode,
    })),
  };
}

/** Один запит до оператора. `fetchImpl` інжектується, щоб тести не ходили в мережу. */
export async function fetchOperatorSchedule(
  queue: string,
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OperatorScheduleResponse> {
  let response: Response;
  try {
    response = await fetchImpl(env.OPERATOR_SCHEDULE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': env.PARSER_USER_AGENT },
      body: JSON.stringify({ queue, curr_dt: date }),
      signal: AbortSignal.timeout(env.PARSE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OperatorScheduleFetchError(
      `Оператор недоступний: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new OperatorScheduleFetchError(`Оператор відповів HTTP ${response.status}`, response.status);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new OperatorScheduleFetchError('Оператор повернув не JSON');
  }
  return normalizeOperatorSchedulePayload(json);
}
