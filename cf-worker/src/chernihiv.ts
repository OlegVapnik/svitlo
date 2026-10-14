/**
 * Точечные ремонтные отключения АТ «Чернігівобленерго» для Cloudflare Worker.
 *
 * Порт логики из apps/api/src/parsers/chernihiv-web.adapter.ts на стандартный Web Fetch API.
 * Источник — публичный веб-эндпоинт оператора `POST /api/list_acc`, который не защищён капчей
 * и не содержит персональных данных (нет ФИО и номера счёта).
 *
 * Типы перерывов: 1 — плановые, 2 — аварийные, 6 — графики ограничений (ГПВ).
 *
 * ЧТО ОСТОРОЖНО. Оператор живёт за WAF и отдаёт данные только браузероподобным клиентам, а
 * список населённых пунктов (`info_disable?nq=city`) может отдавать или не отдавать. Поэтому:
 *   - список НП определяется в рантайме и кэшируется в D1, а не зашивается вручную: зашитый
 *     список из одного села давал бы ложное впечатление, что мы видим всю область;
 *   - при недоступности источника сбор молча не падает и не выдумывает данные — просто
 *     остаются прежние записи, а в /api/v1/status видно время последнего успешного сбора;
 *   - по умолчанию выключено флагом CHERNIHIV_WEB_ENABLED, как и в Node-бэкенде.
 */

/** Человеческие названия типов отключений — используются, если оператор не вернул причину. */
export const OUTAGE_TYPE_LABELS: Record<number, string> = {
  1: 'Планова перерва в електропостачанні',
  2: 'Аварійна перерва в електропостачанні',
  6: 'Графік погодинних відключень (ГПВ)',
};

const DEFAULT_BASE_URL = 'https://chernihivoblenergo.com.ua';

/** Оператор отдаёт «настінний» час Киева без зоны («2026-10-07T17:30:00») — приводим к UTC. */
export function kyivWallClockToUtc(local: string, offsetMinutes: number): number {
  const match = String(local ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/u);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const wallClockAsUtc = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return wallClockAsUtc - offsetMinutes * 60_000;
}

/** «ДЕСНЯНСЬКЕ» → «Деснянське»: не подставляем своё село, а лишь приводим регистр. */
function titleCasePlace(value: string): string {
  const text = String(value ?? '').trim().replace(/\s+/gu, ' ');
  if (!text) return '';
  // Складані назви на кшталт «НОВОГОРОД-СІВЕРСЬКИЙ» не розбиваємо: це різні частини слова.
  return text.toLocaleLowerCase('uk-UA').replace(/(^|[\s-])([а-яіїєґ'])/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}

export interface ChernihivOutage {
  externalId: string;
  startsAt: string;
  endsAt: string;
  areaName: string;
  addressesRaw: string;
  reason: string | null;
  kind: 'repair' | 'emergency' | 'gpv';
}

/**
 * Превращает одну строку `/api/list_acc` в нормализованное отключение.
 *
 * Порт `parseListAccRow`. Персональных данных в строке нет: оператор отдаёт место, улицу,
 * номера домов, время и причину.
 */
export function parseListAccRow(
  row: unknown[],
  type: number,
  cityId: string,
  offsetMinutes: number,
): ChernihivOutage | null {
  const placement = String(row[0] ?? '').trim();
  const street = String(row[1] ?? '').trim();
  const houses = String(row[2] ?? '').trim();
  const startsAtMs = kyivWallClockToUtc(String(row[3] ?? ''), offsetMinutes);
  const endsAtMs = kyivWallClockToUtc(String(row[4] ?? ''), offsetMinutes);
  if (Number.isNaN(startsAtMs) || Number.isNaN(endsAtMs)) return null;
  if (!street && !placement) return null;

  // Название населённого пункта берём ТО, что дал оператор. Подставлять «Деснянское»
  // под все записи нельзя: человек увидел бы ремонт в селе, которого у него нет.
  const areaName = titleCasePlace(placement) || 'Чернігівська область';
  const placementIsArea =
    Boolean(placement) && placement.toLocaleLowerCase('uk-UA') === areaName.toLocaleLowerCase('uk-UA');
  const streetAndHouses = street ? `вул. ${street}${houses ? ` ${houses}` : ''}` : houses;
  const addressesRaw = [placementIsArea ? '' : placement, streetAndHouses]
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/gu, ' ')
    .trim();
  const reason = String(row[6] ?? '').trim() || OUTAGE_TYPE_LABELS[type] || null;

  return {
    externalId: `${cityId}:${type}:${street}:${houses}:${row[3]}:${row[4]}`,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
    areaName,
    addressesRaw: addressesRaw || placement,
    reason,
    kind: type === 2 ? 'emergency' : type === 6 ? 'gpv' : 'repair',
  };
}

/** Заголовки браузерного XHR: оператор под WAF отдаёт данные только им. */
function browserHeaders(baseUrl: string, cookie: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8',
    'user-agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    origin: baseUrl,
    referer: `${baseUrl}/power_outages`,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
  if (cookie) headers['cookie'] = cookie;
  return headers;
}

/** Прогрев сессии: GET /power_outages за cookies, без них оператор может не отдать данные. */
async function warmup(baseUrl: string): Promise<string> {
  try {
    const response = await fetch(`${baseUrl}/power_outages`, {
      headers: { 'user-agent': browserHeaders(baseUrl, '')['user-agent']!, accept: 'text/html' },
    });
    const setCookie = response.headers.get('set-cookie') ?? '';
    return setCookie
      .split(/,(?=\s*[^;=]+=)/u)
      .map((part) => part.split(';')[0]!.trim())
      .filter(Boolean)
      .join('; ');
  } catch {
    return '';
  }
}

/** Список идентификаторов населённых пунктов оператора. */
export async function fetchCityIds(baseUrl: string, cookie: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/info_disable?nq=city`, {
    headers: browserHeaders(baseUrl, cookie),
  });
  if (!response.ok) throw new Error(`operator: справочник НП вернул HTTP ${response.status}`);
  const parsed: unknown = await response.json();
  // Формат ответа оператора менялся; берём любые строковые идентификаторы из типовых полей.
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  const ids: string[] = [];
  for (const item of candidates) {
    if (typeof item === 'string' || typeof item === 'number') ids.push(String(item));
    else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const id = record['id'] ?? record['city_id'] ?? record['code'] ?? record['value'];
      if (typeof id === 'string' || typeof id === 'number') ids.push(String(id));
    }
  }
  return [...new Set(ids)];
}

/** Забирает перерывы по одному населённому пункту и одному типу. */
export async function fetchListAcc(
  baseUrl: string,
  cookie: string,
  cityId: string,
  type: number,
): Promise<unknown[]> {
  const body = { req_param: encodeURIComponent(JSON.stringify({ c: cityId, t: type })) };
  const response = await fetch(`${baseUrl}/api/list_acc`, {
    method: 'POST',
    headers: browserHeaders(baseUrl, cookie),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`operator: list_acc вернул HTTP ${response.status}`);
  const parsed = (await response.json()) as { list?: unknown[] };
  return Array.isArray(parsed?.list) ? parsed.list : [];
}

/**
 * Полный обход оператора за один запуск крона.
 *
 * Пауза между запросами обязательна: равномерный поток — самая заметная примета автоматизации,
 * и без неё оператор банит IP. Обращаемся последовательно, а не параллельно.
 */
export async function collectChernihivOutages(
  options: { cityIds: string[]; types: number[]; baseUrl?: string; requestDelayMs?: number },
  offsetMinutes: number,
): Promise<ChernihivOutage[]> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const delay = options.requestDelayMs ?? 400;
  const cookie = await warmup(baseUrl);

  const outages: ChernihivOutage[] = [];
  for (const cityId of options.cityIds) {
    for (const type of options.types) {
      try {
        const list = await fetchListAcc(baseUrl, cookie, cityId, type);
        for (const row of list) {
          if (!Array.isArray(row)) continue;
          const parsed = parseListAccRow(row, type, cityId, offsetMinutes);
          if (parsed) outages.push(parsed);
        }
      } catch {
        // Одна неудачная пара (город:тип) — это частичное наблюдение, а не «оператор всё
        // отменил». Остальные порции дособираем, иначе одна ошибка обнуляла бы весь обход.
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return outages;
}
