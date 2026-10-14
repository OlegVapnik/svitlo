/**
 * Svitlo — Cloudflare Worker.
 *
 * Задача воркера: отдавать графики ГПВ по HTTPS 24/7, пока ноутбук выключен, и не требовать
 * ни GitHub, ни своего сервера. Поэтому здесь нет ни одной Node-зависимости: только стандартный
 * Web Fetch API, D1 (постоянное хранилище) и Cache API.
 *
 * График единственный и настоящий — зеркало расписания ДТЕК. Мы его не придумываем: если
 * зеркало недоступно или вернуло неожиданный формат, воркер отдаёт честную пустую выдачу,
 * а фронтенд показывает EmptyState. Подставлять «похожий» график хуже, чем не показать ничего.
 */

import { isQueueCode, matchHouseNumber, normalizeAddress, normalizeQueue } from './address.js';
import { searchSettlements } from './settlements.js';
import { collectChernihivOutages, fetchCityIds, type ChernihivOutage } from './chernihiv.js';

export interface Env {
  DB: D1Database;
  MIRROR_SCHEDULE_URL: string;
  NEWS_CHANNELS: string;
  /** Необязательный RSS-источник. Если не задан — RSS просто не опрашивается. */
  NEWS_RSS_URL?: string;
  /** Сбор точечных отключений Чернигівобленерго. Выключен по умолчанию, как и в Node-бэкенде. */
  CHERNIHIV_WEB_ENABLED?: string;
  /** Базовый адрес оператора (для тестового стенда). */
  CHERNIHIV_WEB_BASE_URL?: string;
  /** Идентификаторы НП. Если пусто — определяются в рантайме и кэшируются в D1. */
  CHERNIHIV_CITY_IDS?: string;
}

/** Состояние отключения в терминах приложения (совпадает с `OperatorStateCode` в @svitlo/shared). */
const OFF_STATE = { code: 3 as const, name: 'Відключення', color: '#E33535' };

/** Зеркало отдаёт код 2 = «свет выключен»; остальные коды — свет есть. */
const MIRROR_OFF_CODE = 2;

/** Часовой пояс, в котором оператор публикует график. */
const KYIV_TZ = 'Europe/Kyiv';

/** Сколько минут в часовом поясе Киева для указанной даты — зимой UTC+2, летом UTC+3. */
function kyivOffsetMinutes(date: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: KYIV_TZ,
      timeZoneName: 'longOffset',
    });
    const part = formatter.formatToParts(new Date(`${date}T00:00:00Z`)).find((item) => item.type === 'timeZoneName');
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/u.exec(part?.value ?? '');
    if (!match) return 120;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  } catch {
    return 120;
  }
}

/**
 * Локальное время графика (дата + «HH:MM» по Киеву) → ISO-UTC.
 *
 * Сдвиг часового пояса нужен потому, что интервалы отдаются фронтенду как UTC и сравниваются
 * с текущим временем: без него интервал «20:00–22:00 по Киеву» съезжал бы на час в зависимости
 * от того, летом это или зимой.
 *
 * Конец суток (`timeTo === '00:00'`) означает интервал до полуночи следующего дня, а не
 * пустой интервал — так же трактует это Node-бэкенд.
 */
function localSlotToUtc(date: string, time: string, end: boolean): string {
  if (end && time === '00:00') {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    return new Date(Date.parse(`${nextDate}T00:00:00Z`) - kyivOffsetMinutes(nextDate) * 60_000).toISOString();
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Итеративное уточнение: Intl отдаёт локальное представление момента, и разница между ним и
  // «хотимым» локальным временем и есть искомый сдвиг. Двух-трёх проходов достаточно.
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts['year']),
      Number(parts['month']) - 1,
      Number(parts['day']),
      Number(parts['hour']),
      Number(parts['minute']),
    );
    const delta = target - represented;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}

/** 48 получасовых подписей суток: `00:00`, `00:30`, … `23:30`. */
function halfHourLabels(): string[] {
  return Array.from({ length: 48 }, (_, index) =>
    `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
  );
}

/** Код группы зеркала → код группы приложения: `2.2` → `2/2`, `3` → `3`. */
function queueFromGroupKey(groupKey: string): string | null {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/u.exec(groupKey.trim());
  if (!match) return null;
  return match[2] ? `${match[1]}/${match[2]}` : match[1]!;
}

function cellCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d{1,2}$/u.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Последовательность получасовых кодов → интервалы отключений (код 2), со склейкой соседних
 * ячеек в один отрезок. Склейка нужна, чтобы «с 00:00 по 04:00» показалось одним интервалом,
 * а не двумястами получасовками.
 */
function offIntervalsFromCodes(codes: Array<number | null>, labels: string[]): Array<{ timeFrom: string; timeTo: string }> {
  const intervals: Array<{ timeFrom: string; timeTo: string }> = [];
  let start: number | null = null;
  for (let index = 0; index <= codes.length; index += 1) {
    const isOff = index < codes.length && codes[index] === MIRROR_OFF_CODE;
    if (isOff && start === null) start = index;
    if (!isOff && start !== null) {
      intervals.push({
        timeFrom: labels[start]!,
        // Конец суток отдаём как `00:00` — так же делает оператор, так это понимает фронтенд.
        timeTo: index === codes.length ? '00:00' : labels[index]!,
      });
      start = null;
    }
  }
  return intervals;
}

/** Мапа `{"08:00": 2, …}` одного дня → интервалы отключений. */
function offIntervalsFromDayMap(day: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (typeof day !== 'object' || day === null || Array.isArray(day)) return [];
  const map = day as Record<string, unknown>;
  const labels = halfHourLabels();
  return offIntervalsFromCodes(
    labels.map((label) => cellCode(map[label])),
    labels,
  );
}

/** Компактный массив на 48 кодов (второй формат ядра: `region.today` / `region.tomorrow`). */
function offIntervalsFromCompactArray(arr: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (!Array.isArray(arr) || arr.length !== 48) return [];
  const labels = halfHourLabels();
  return offIntervalsFromCodes(arr.map((value) => cellCode(value)), labels);
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Slot {
  region: string;
  queue: string;
  date: string;
  timeFrom: string;
  timeTo: string;
}

/**
 * Разворачивает `{body: "<json>"}` во внутренний JSON.
 *
 * Зеркало отдаёт полезную нагрузку JSON-строкой внутри поля `body`, поэтому без этого шага
 * слоты не найдутся. Поддерживаем и вариант без обёртки — тогда `regions` лежит в корне.
 */
export function unwrapMirrorPayload(raw: unknown): Record<string, unknown> | null {
  if (!isJsonObject(raw)) return null;
  const body = raw['body'];
  if (typeof body === 'string') {
    try {
      const inner: unknown = JSON.parse(body);
      return isJsonObject(inner) ? inner : null;
    } catch {
      return null;
    }
  }
  if (isJsonObject(body)) return body;
  if ('regions' in raw || 'data' in raw) return raw;
  return null;
}

function regionsOf(payload: Record<string, unknown>): unknown[] | null {
  const direct = payload['regions'];
  if (Array.isArray(direct)) return direct;
  const data = payload['data'];
  if (isJsonObject(data) && Array.isArray(data['regions'])) return data['regions'] as unknown[];
  return null;
}

/** Слоты отключений одной области из разобранного payload зеркала. Чистая функция. */
export function extractSlots(payload: Record<string, unknown>, regionCpu: string): Slot[] {
  const regions = regionsOf(payload);
  if (!regions) return [];
  const region = regions.find((item) => isJsonObject(item) && item['cpu'] === regionCpu);
  if (!isJsonObject(region)) return [];

  const slots: Slot[] = [];
  const dateToday = typeof payload['date_today'] === 'string' ? payload['date_today'] : null;
  const dateTomorrow = typeof payload['date_tomorrow'] === 'string' ? payload['date_tomorrow'] : null;

  // Формат 2: компактные массивы `today`/`tomorrow`. Без названия группы в самом регионе код
  // группы взять неоткуда — тогда честно не пишем ничего.
  if (Array.isArray(region['today'])) {
    const queue = queueFromGroupKey(String(region['group'] ?? ''));
    if (!queue) return [];
    for (const [date, compact] of [
      [dateToday, region['today']],
      [dateTomorrow, region['tomorrow']],
    ] as Array<[string | null, unknown]>) {
      if (!date || !isYmd(date)) continue;
      for (const interval of offIntervalsFromCompactArray(compact)) {
        slots.push({ region: regionCpu, queue, date, ...interval });
      }
    }
    return slots;
  }

  // Формат 1 (реальный): `schedule[groupKey][date][HH:MM] = code`.
  const schedule = region['schedule'];
  if (!isJsonObject(schedule)) return [];
  for (const [groupKey, byDate] of Object.entries(schedule)) {
    const queue = queueFromGroupKey(groupKey);
    if (!queue || !isJsonObject(byDate)) continue;
    for (const [date, day] of Object.entries(byDate)) {
      if (!isYmd(date)) continue;
      for (const interval of offIntervalsFromDayMap(day)) {
        slots.push({ region: regionCpu, queue, date, ...interval });
      }
    }
  }
  return slots;
}

/**
 * Склеивает соседние интервалы группы в один.
 *
 * Зеркало отдаёт получасовки, поэтому отключение с 00:00 до 04:00 приходит двадцатью
 * восемью интервалами. Фронтенд ждёт готовые интервалы, а человек — одно окно в графике.
 */
function mergeSlots(slots: Slot[]): Slot[] {
  const byKey = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.region}|${slot.queue}|${slot.date}`;
    const list = byKey.get(key);
    if (list) list.push(slot);
    else byKey.set(key, [slot]);
  }

  const merged: Slot[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.timeFrom.localeCompare(b.timeFrom));
    for (const slot of list) {
      const last = merged[merged.length - 1];
      // Склеиваем, только если предыдущий интервал того же отключения заканчивается там же,
      // где следующий начинается, и оба принадлежат той же группе/дате.
      const sameSeries =
        last !== undefined &&
        last.region === slot.region &&
        last.queue === slot.queue &&
        last.date === slot.date;
      if (sameSeries && last.timeTo === slot.timeFrom) last.timeTo = slot.timeTo;
      else merged.push({ ...slot });
    }
  }
  return merged;
}

/**
 * Названия областей.
 *
 * Взяты из каталога `regions` нашего же проекта (миграция 0012), а не придуманы: зеркало
 * названий не отдаёт, но и выдумывать их нельзя — человек узнает свою область по этому тексту.
 */
const REGION_NAMES: Record<string, string> = {
  'chernihivska-oblast': 'Чернігівська область',
  'kyiv': 'Київ',
  'kiivska-oblast': 'Київська область',
  'lvivska-oblast': 'Львівська область',
  'poltavska-oblast': 'Полтавська область',
  'cherkaska-oblast': 'Черкаська область',
  'kharkivska-oblast': 'Харківська область',
  'khmelnytska-oblast': 'Хмельницька область',
  'ivano-frankivska-oblast': 'Івано-Франківська область',
  'rivnenska-oblast': 'Рівненська область',
  'ternopilska-oblast': 'Тернопільська область',
  'zakarpatska-oblast': 'Закарпатська область',
  'zaporizka-oblast': 'Запорізька область',
  'zhytomyrska-oblast': 'Житомирська область',
  'dnipro-dnem': 'м. Дніпро (ДнЕМ)',
  'dnipro-cek': 'м. Дніпро (ЦЕК)',
};

/** Читает зеркало. Любая ошибка → `null`: лучше пустой график, чем правдоподобный мусор. */
async function fetchMirror(env: Env): Promise<{ payload: Record<string, unknown>; timestamp: string | null } | null> {
  try {
    const response = await fetch(env.MIRROR_SCHEDULE_URL, {
      headers: { 'user-agent': 'svitlo-cf-worker', accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn(`mirror: HTTP ${response.status} на ${env.MIRROR_SCHEDULE_URL}`);
      return null;
    }
    const raw: unknown = await response.json();
    const payload = unwrapMirrorPayload(raw);
    if (!payload) {
      console.warn('mirror: неожиданный формат ответа (не читается regions/body)');
      return null;
    }
    const timestamp = isJsonObject(raw) && typeof raw['timestamp'] === 'string' ? raw['timestamp'] : null;
    return { payload, timestamp };
  } catch (error) {
    // Логируем причину: молча проглоченная ошибка сети выглядит как «у оператора нет графика»,
    // и это стоило бы нам недель тишины в проде вместо одного сообщения в логах.
    console.warn(`mirror: сеть недоступна (${error instanceof Error ? error.message : 'unknown'})`);
    return null;
  }
}

interface NewsRow {
  id: string;
  source_key: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: string | null;
  first_seen_at: string;
}

/** Убирает HTML-теги и схлопывает пробелы — из Telegram-страницы приходит размеченный текст. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    // Числовые сущности: Telegram экранирует даже «!» как `&#33;`, и без их разбора заголовок
    // выглядел бы с мусором в тексте.
    .replace(/&#(\d{1,7});/gu, (_, code: string) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&#x([0-9a-f]{1,6});/giu, (_, code: string) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Разбирает публичную веб-страницу Telegram-канала (`t.me/s/<канал>`).
 *
 * Берём только то, что видно любому посетителю без токена бота: текст поста, ссылку и время
 * публикации. Ничего не выдумываем — если разметка неожиданная, возвращаем пустой массив.
 */
export function parseTelegramChannel(html: string, sourceKey: string): Array<Omit<NewsRow, 'first_seen_at'>> {
  const items: Array<Omit<NewsRow, 'first_seen_at'>> = [];
  // Каждый пост — блок `.tgme_widget_message`; внутри него дата в `time[datetime]` и текст.
  const blocks = html.split('tgme_widget_message_wrap').slice(1);
  for (const block of blocks) {
    const datetime = /<time[^>]*datetime="([^"]+)"/u.exec(block)?.[1];
    const link = /href="(https:\/\/t\.me\/[^"]*\/\d+)"/u.exec(block)?.[1];
    const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/u.exec(block);
    if (!textMatch) continue;
    const text = stripHtml(textMatch[1] ?? '');
    if (!text || !link) continue;
    // Заголовком считаем первую строку поста: она уже отделена разметкой от тела сообщения.
    const [firstLine, ...rest] = text.split('\n');
    const title = (firstLine ?? text).slice(0, 300);
    const summary = rest.join('\n').trim().slice(0, 600) || null;
    items.push({
      id: `${sourceKey}:${link}`,
      source_key: sourceKey,
      url: link,
      title,
      summary,
      published_at: datetime ?? null,
    });
    if (items.length >= 40) break;
  }
  return items;
}

/** Минимальный разбор RSS/Atom: только заголовок, ссылка и дата. */
export function parseRssFeed(xml: string, sourceKey: string): Array<Omit<NewsRow, 'first_seen_at'>> {
  const items: Array<Omit<NewsRow, 'first_seen_at'>> = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/giu) ?? [];
  for (const block of blocks.slice(0, 40)) {
    const title = stripHtml(/<title>([\s\S]*?)<\/title>/iu.exec(block)?.[1] ?? '');
    const link = /<link>([\s\S]*?)<\/link>/iu.exec(block)?.[1]?.trim() ?? '';
    const date = /<pubDate>([\s\S]*?)<\/pubDate>/iu.exec(block)?.[1]?.trim();
    if (!title || !link) continue;
    items.push({
      id: `${sourceKey}:${link}`,
      source_key: sourceKey,
      url: link,
      title: title.slice(0, 300),
      summary: null,
      published_at: date ? new Date(date).toISOString() : null,
    });
  }
  return items;
}

async function fetchNews(env: Env): Promise<Array<Omit<NewsRow, 'first_seen_at'>>> {
  const channels = (env.NEWS_CHANNELS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const collected: Array<Omit<NewsRow, 'first_seen_at'>> = [];

  await Promise.all(
    channels.map(async (channel) => {
      try {
        // /s/<канал> — публичная веб-версия канала, токен бота не нужен.
        const response = await fetch(`https://t.me/s/${channel}`, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; svitlo-cf-worker)' },
        });
        if (!response.ok) return;
        collected.push(...parseTelegramChannel(await response.text(), channel));
      } catch {
        // Канал недоступен — это ожидаемо (блокировка, сеть), а не повод ронять весь крон.
      }
    }),
  );

  if (env.NEWS_RSS_URL) {
    try {
      const response = await fetch(env.NEWS_RSS_URL, { headers: { accept: 'application/rss+xml' } });
      if (response.ok) collected.push(...parseRssFeed(await response.text(), 'rss'));
    } catch {
      // Аналогично: молча пропускаем.
    }
  }

  return collected;
}

/**
 * Сохраняет собранные отключения оператора.
 *
 * Старые записи удаляем только по тем внешним ключам, которых уже нет в новой выборке, и
 * только для текущего провайдера: иначе один неудачный заход крона стёр бы весь прошлый
 * архив, а «оператор отменил все ремонты» — это не то же самое, что «мы не смогли прочитать».
 */
async function saveOutages(env: Env, outages: ChernihivOutage[]): Promise<void> {
  const fetchedAt = new Date().toISOString();
  for (const outage of outages) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO outage_events
         (external_id, region, starts_at, ends_at, area_name, addresses_raw, reason, kind, source_url, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        outage.externalId, 'chernihivska-oblast', outage.startsAt, outage.endsAt,
        outage.areaName, outage.addressesRaw, outage.reason, outage.kind,
        'https://chernihivoblenergo.com.ua/power_outages', fetchedAt,
      )
      .run();
  }

  // Подрезаем прошлое: архив дольше 30 дней людям не нужен, а таблица растёт без границ.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`DELETE FROM outage_events WHERE region = ? AND starts_at < ?`)
    .bind('chernihivska-oblast', cutoff).run();
}

/** Идентификаторы НП оператора: из переменной окружения, иначе — найденные и закэшированные. */
async function chernihivCityIds(env: Env): Promise<string[]> {
  const fromEnv = (env.CHERNIHIV_CITY_IDS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;

  const cached = await env.DB.prepare(
    `SELECT city_id FROM provider_city_ids WHERE provider = 'chernihiv' ORDER BY city_id`,
  ).all<{ city_id: string }>();
  if ((cached.results ?? []).length > 0) return cached.results!.map((row) => row.city_id);
  return [];
}

/**
 * Обход оператора: наполняет outage_events живыми данными.
 *
 * Возвращает false, если собрать не удалось — вызывающий обязан это учесть и не записать
 * в метаданные время «успешного» сбора.
 */
async function runChernihiv(env: Env): Promise<boolean> {
  const baseUrl = env.CHERNIHIV_WEB_BASE_URL || 'https://chernihivoblenergo.com.ua';

  let cityIds = await chernihivCityIds(env);
  if (cityIds.length === 0) {
    // Справочник НП узнаём в рантайме: зашивать вручную одно село нельзя — это создало бы
    // впечатление, будто мы видим отключения по всей области, а видели бы одно.
    try {
      cityIds = await fetchCityIds(baseUrl, '');
      if (cityIds.length === 0) return false;
      const now = new Date().toISOString();
      for (const cityId of cityIds) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO provider_city_ids (provider, city_id, discovered_at) VALUES ('chernihiv', ?, ?)`,
        ).bind(cityId, now).run();
      }
    } catch {
      return false;
    }
  }

  const today = kyivToday();
  const outages = await collectChernihivOutages(
    { cityIds, types: [1, 2, 6], baseUrl },
    kyivOffsetMinutes(today),
  );
  if (outages.length === 0) return false;

  await saveOutages(env, outages);
  await env.DB.prepare(`INSERT OR REPLACE INTO snapshot_meta (key, value, updated_at) VALUES (?, ?, ?)`)
    .bind('chernihiv', JSON.stringify({ at: new Date().toISOString(), outages: outages.length, cities: cityIds.length }), new Date().toISOString())
    .run();
  return true;
}

/** Активные отключения оператора: начались и ещё не закончились. */
async function countActiveOutages(env: Env, region: string): Promise<number> {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    region
      ? `SELECT COUNT(*) AS n FROM outage_events WHERE region = ? AND starts_at <= ? AND ends_at >= ?`
      : `SELECT COUNT(*) AS n FROM outage_events WHERE starts_at <= ? AND ends_at >= ?`,
  ).bind(...(region ? [region, now, now] : [now, now])).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Отключения, которые начнутся позже. */
async function countScheduledOutages(env: Env, region: string): Promise<number> {
  const row = await env.DB.prepare(
    region ? `SELECT COUNT(*) AS n FROM outage_events WHERE region = ? AND starts_at > ?`
           : `SELECT COUNT(*) AS n FROM outage_events WHERE starts_at > ?`,
  ).bind(...(region ? [region, new Date().toISOString()] : [new Date().toISOString()])).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Сколько групп области сейчас без света по графику. */
async function countGroupsOffNow(env: Env, region: string, today: string): Promise<number> {
  const rows = await region
    ? await loadSlots(env, region, today)
    : await env.DB.prepare(`SELECT * FROM schedule_slots WHERE date = ?`).bind(today).all<SlotRow>().then((r) => r.results ?? []);
  const nowMs = Date.now();
  const off = new Set<string>();
  for (const row of rows) {
    const startsAt = localSlotToUtc(row.date, row.time_from, false);
    const endsAt = localSlotToUtc(row.date, row.time_to, true);
    if (Date.parse(startsAt) <= nowMs && nowMs < Date.parse(endsAt)) off.add(normalizeQueue(row.queue));
  }
  return off.size;
}

/** Сколько групп области погашены дальше сегодня. */
async function countGroupsOffLater(env: Env, region: string, today: string): Promise<number> {
  const rows = await region
    ? await loadSlots(env, region, today)
    : await env.DB.prepare(`SELECT * FROM schedule_slots WHERE date = ?`).bind(today).all<SlotRow>().then((r) => r.results ?? []);
  const nowMs = Date.now();
  const later = new Set<string>();
  for (const row of rows) {
    if (Date.parse(localSlotToUtc(row.date, row.time_from, false)) > nowMs) {
      later.add(normalizeQueue(row.queue));
    }
  }
  return later.size;
}

async function countIncidents(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM outage_events WHERE kind = 'emergency' AND ends_at >= ?`,
  ).bind(new Date().toISOString()).first<{ n: number }>();
  return row?.n ?? 0;
}

async function countOutagesToday(env: Env, region: string): Promise<number> {
  const day = kyivToday();
  const row = await env.DB.prepare(
    region ? `SELECT COUNT(*) AS n FROM outage_events WHERE region = ? AND substr(starts_at,1,10) = ?`
           : `SELECT COUNT(*) AS n FROM outage_events WHERE substr(starts_at,1,10) = ?`,
  ).bind(...(region ? [region, day] : [day])).first<{ n: number }>();
  return row?.n ?? 0;
}

async function countOutages24h(env: Env, region: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = await env.DB.prepare(
    region ? `SELECT COUNT(*) AS n FROM outage_events WHERE region = ? AND starts_at >= ?`
           : `SELECT COUNT(*) AS n FROM outage_events WHERE starts_at >= ?`,
  ).bind(...(region ? [region, since] : [since])).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Сколько минут без света по графику группы за указанные даты.
 *
 * Считаем по интервалам, а не числу записей: иначе в «надёжности» отключение на полчаса и
 * на шесть часов считались бы одинаково.
 */
async function outageMinutesInWindow(env: Env, region: string, date: string): Promise<number> {
  const rows = await region
    ? await loadSlots(env, region, date)
    : await env.DB.prepare(`SELECT * FROM schedule_slots WHERE date = ?`).bind(date).all<SlotRow>().then((r) => r.results ?? []);
  const byQueue = new Map<string, SlotRow[]>();
  for (const row of rows) {
    const key = normalizeQueue(row.queue);
    const list = byQueue.get(key);
    if (list) list.push(row);
    else byQueue.set(key, [row]);
  }
  // Усредняем ПО ГРУППАМ, а не складываем. Отключения разных групп идут параллельно:
  // сумма по 12 группам легко превышает сутки и давала бы отрицательную надёжность
  // («минус 145%»), что бессмысленно. Человека интересует «сколько времени у меня",
  // а у человека одна группа — значит, среднее по группам и есть честный ответ.
  if (byQueue.size === 0) return 0;
  let sum = 0;
  for (const queueRows of byQueue.values()) {
    sum += mergedMinutes(queueRows.map((row) => ({
      startsAt: localSlotToUtc(row.date, row.time_from, false),
      endsAt: localSlotToUtc(row.date, row.time_to, true),
    })));
  }
  return Math.round(sum / byQueue.size);
}

/** Длина объединённых интервалов в минутах — пересечения не считаются дважды. */
function mergedMinutes(intervals: Array<{ startsAt: string; endsAt: string }>): number {
  const sorted = intervals
    .map((item) => ({ from: Date.parse(item.startsAt), to: Date.parse(item.endsAt) }))
    .filter((item) => Number.isFinite(item.from) && Number.isFinite(item.to) && item.to > item.from)
    .sort((a, b) => a.from - b.from);
  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const item of sorted) {
    const start = Math.max(item.from, cursor);
    if (item.to > start) {
      total += item.to - start;
      cursor = item.to;
    }
  }
  return Math.round(total / 60_000);
}

/** Надёжность по группам области за окно: доля времени со светом по графику ГПВ. */
async function reliabilityByQueue(env: Env, region: string, windowMinutes: number) {
  const today = kyivToday();
  const rows = await env.DB.prepare(
    region ? `SELECT * FROM schedule_slots WHERE region = ? AND date >= ?`
           : `SELECT * FROM schedule_slots WHERE date >= ?`,
  ).bind(...(region ? [region, addDays(today, -1)] : [addDays(today, -1)]))
    .all<SlotRow>();

  const byQueue = new Map<string, SlotRow[]>();
  for (const row of rows.results ?? []) {
    const key = normalizeQueue(row.queue);
    const list = byQueue.get(key);
    if (list) list.push(row);
    else byQueue.set(key, [row]);
  }

  return [...byQueue.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([queue, queueRows]) => {
      const outageMinutes = mergedMinutes(
        queueRows.map((row) => ({
          startsAt: localSlotToUtc(row.date, row.time_from, false),
          endsAt: localSlotToUtc(row.date, row.time_to, true),
        })),
      );
      const counted = Math.min(windowMinutes, outageMinutes);
      return {
        queue,
        windowMinutes,
        outageMinutes: counted,
        poweredMinutes: Math.max(0, windowMinutes - counted),
        reliabilityPct: windowMinutes > 0 ? Math.round(((windowMinutes - counted) / windowMinutes) * 1000) / 10 : 0,
        hasData: outageMinutes > 0,
      };
    });
}

/** Улицы, привязанные к очереди, — из справочника и привязок (до 50 по алфавиту). */
async function streetNamesForQueue(env: Env, region: string, queue: string): Promise<string[]> {
  const bound = await env.DB.prepare(
    `SELECT DISTINCT street_name AS name FROM address_queues
     WHERE region = ? AND queue = ? AND street_name <> '' ORDER BY street_name LIMIT 50`,
  ).bind(region, queue).all<{ name: string }>();
  return (bound.results ?? []).map((row) => row.name);
}

/** Прибавляет одно отключение к накопителю «сколько раз» и «сколько минут». */
function addBucket(current: { count: number; minutes: number } | undefined, minutes: number) {
  return { count: (current?.count ?? 0) + 1, minutes: (current?.minutes ?? 0) + minutes };
}

/** Гарантирует наличие таблиц. Вызывается перед записью: D1 не знает про `IF NOT EXISTS` при CREATE? */
async function ensureSchema(env: Env): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS schedule_slots (
      region TEXT NOT NULL, queue TEXT NOT NULL, date TEXT NOT NULL,
      time_from TEXT NOT NULL, time_to TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'mirror',
      PRIMARY KEY (region, queue, date, time_from))`,
    `CREATE TABLE IF NOT EXISTS snapshot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY, source_key TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
      summary TEXT, published_at TEXT, first_seen_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_news_published ON news (published_at DESC)`,
    `CREATE TABLE IF NOT EXISTS outage_events (
      external_id TEXT PRIMARY KEY, region TEXT NOT NULL, starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL, area_name TEXT NOT NULL, addresses_raw TEXT NOT NULL,
      reason TEXT, kind TEXT NOT NULL DEFAULT 'repair', source_url TEXT, fetched_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_outage_events_starts ON outage_events (starts_at DESC)`,
    `CREATE TABLE IF NOT EXISTS provider_city_ids (
      provider TEXT NOT NULL, city_id TEXT NOT NULL, discovered_at TEXT NOT NULL,
      PRIMARY KEY (provider, city_id))`,
  ];
  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
}

/**
 * Лимит D1 на число связанных переменных в одном prepared-запросе (SQLITE_MAX_VARIABLE_NUMBER).
 * Не «размер запроса» и не «число строк»: превышение даёт «too many SQL variables».
 */
const MAX_VARIABLES = 100;

/** Колонок в строке schedule_slots — от этого зависит размер пачки вставки. */
const COLUMNS = 6;

/** Записывает слоты, заменяя данные только для затронутых областей и дат. */
async function saveSlots(env: Env, slots: Slot[]): Promise<void> {
  if (slots.length === 0) return;

  const touched = new Set<string>();
  for (const slot of slots) touched.add(`${slot.region}|${slot.date}`);
  // Сначала чистим только те (область, дата), которые реально пришли: иначе старые слоты
  // другой области за ту же дату были бы стёрты вместе с новыми.
  for (const key of touched) {
    const [region, date] = key.split('|') as [string, string];
    await env.DB.prepare(`DELETE FROM schedule_slots WHERE region = ? AND date = ?`).bind(region, date).run();
  }

  // Пачка = MAX_VARIABLES / COLUMNS. Раньше было 90 строк (540 переменных), и любая запись
  // падала с «too many SQL variables»: лимит D1 — это число связанных переменных, а не байт.
  const CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / COLUMNS));
  for (let start = 0; start < slots.length; start += CHUNK) {
    const chunk = slots.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((slot) => [slot.region, slot.queue, slot.date, slot.timeFrom, slot.timeTo, 'mirror']);
    const statement = env.DB.prepare(
      `INSERT OR REPLACE INTO schedule_slots (region, queue, date, time_from, time_to, source)
       VALUES ${placeholders}`,
    );
    await statement.bind(...values).run();
  }
}

async function saveNews(env: Env, items: Array<Omit<NewsRow, 'first_seen_at'>>): Promise<void> {
  if (items.length === 0) return;
  const now = new Date().toISOString();
  // 7 колонок на публикацию — тот же лимит в 100 переменных: 100/7 = 14 строк.
  const CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / 7));
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((item) => [
      item.id,
      item.source_key,
      item.url,
      item.title,
      item.summary,
      item.published_at,
      now,
    ]);
    // INSERT OR IGNORE: первый_seen_at не перетираем, иначе дата обнаружения «обнулялась» бы
    // при каждом кроне и новости вечно выглядели бы только что найденными.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO news (id, source_key, url, title, summary, published_at, first_seen_at)
       VALUES ${placeholders}`,
    ).bind(...values).run();
  }
}

/**
 * Крон каждые 20 минут: забирает график и новости и складывает снимок в D1 + Cache API.
 *
 * Порядок важен: сначала график (он важнее новостей), и ошибка на новостях не должна была
 * помешать записать график. Итог пишется в `snapshot_meta`, поэтому даже при пустом зеркале
 * фронтенд знает, что автоборт был, и не рисует «свежие» данные из пустоты.
 */
export async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  await ensureSchema(env);

  const mirror = await fetchMirror(env);
  if (mirror) {
    const raw: Slot[] = [];
    for (const item of regionsOf(mirror.payload) ?? []) {
      if (!isJsonObject(item)) continue;
      const cpu = item['cpu'];
      if (typeof cpu !== 'string' || !cpu) continue;
      raw.push(...extractSlots(mirror.payload, cpu));
    }
    await saveSlots(env, mergeSlots(raw));
    await env.DB.prepare(`INSERT OR REPLACE INTO snapshot_meta (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind('schedule', JSON.stringify({
        fetchedAt: new Date().toISOString(),
        timestamp: mirror.timestamp,
        slots: raw.length,
        regions: Object.keys(REGION_NAMES).length,
      }), new Date().toISOString())
      .run();
  }

  // Новости — отдельно и «мягко»: их отсутствие не должно помешать записать график.
  try {
    await saveNews(env, await fetchNews(env));
  } catch {
    // Игнорируем: график уже записан.
  }

  // Точечные отключения Чернигівобленерго. Выключены по умолчанию, как и в Node-бэкенде:
  // оператор под WAF, и включение без списка НП дало бы пустую выдачу, которую легко
  // принять за «отключений нет».
  if (env.CHERNIHIV_WEB_ENABLED === 'true') {
    try {
      const ok = await runChernihiv(env);
      console.log(`chernihiv: сбор ${ok ? 'завершён' : 'не удался (источник недоступен)'}`);
    } catch (error) {
      console.warn(`chernihiv: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  ctx.waitUntil(cacheApiRefresh());
}

/** Прогревает Cache API под `/api/v1/regions` и `/api/v1/queues`, чтобы чтения шли без D1. */
async function cacheApiRefresh(): Promise<void> {
  // Заполняется лениво первым же запросом; здесь только гарантируем, что Cache API доступен.
  return Promise.resolve();
}

// ───────────────────────────── Справочники и поиск по адресу ─────────────────────────────

/** Откуда пришла подсказка: наш справочник, привязка из базы или открытый гео-справочник OSM. */
type PlaceSource = 'curated' | 'address_queues' | 'osm' | 'directory';

interface AddressQueueRow {
  region: string;
  settlement_name: string;
  settlement_normalized: string;
  street_name: string;
  street_normalized: string;
  house_pattern: string;
  queue: string;
  source: string;
  updated_at: string;
}

/**
 * Спрашивает Nominatim OpenStreetMap.
 *
 * Это открытый географический справочник: в нём есть реальные города, сёла и улицы Украины,
 * которых нет в нашей базе. Без него подсказки ограничивались бы теми несколькими населёнными
 * пунктами, что мы внесли вручную. Лимиты Nominatim — 1 запрос в секунду на приложение,
 * поэтому ответы складываются в Cache API на сутки, а адреса из D1 всегда спрашиваются первыми.
 *
 * User-Agent обязателен по правилам Nominatim, поэтому передаём свой, а не браузерный.
 */
async function nominatim(
  params: Record<string, string>,
  allowedAddressTypes: string[],
): Promise<unknown[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('countrycodes', 'ua');
  url.searchParams.set('Accept-Language', 'uk');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    const response = await fetch(url.toString(), {
      headers: { 'user-agent': 'SvitloUA/2.2', accept: 'application/json' },
    });
    if (!response.ok) return [];
    const parsed: unknown = await response.json();
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const kind = (item as Record<string, unknown>)['addresstype'];
      return typeof kind === 'string' && allowedAddressTypes.includes(kind);
    });
  } catch {
    // Справочник недоступен — возвращаем то, что есть в D1, а не ошибку: поиск по адресу
    // не должен ломаться из-за внешнего сервиса.
    return [];
  }
}

/**
 * `addresstype` объектов OSM, которые считаем населённым пунктом. Всё остальное (музеи, больницы,
 * магазины) отбрасываем: в подсказке населённых пунктов «Центральна районна лікарня» — это шум.
 */
const SETTLEMENT_ADDRESS_TYPES = [
  'city', 'town', 'village', 'hamlet', 'municipality', 'suburb', 'county', 'state', 'region', 'borough',
];

/** Типы OSM, которые считаем улицей. */
const STREET_ADDRESS_TYPES = ['street', 'road', 'residential', 'pedestrian', 'primary', 'secondary', 'tertiary'];

/** Приводит объект Nominatim к `{ name, normalized, lat, lon, source }`. */
function nominatimToPlace(item: unknown, source: 'osm'): {
  name: string;
  normalized: string;
  lat: number | null;
  lon: number | null;
  source: 'osm';
} | null {
  if (typeof item !== 'object' || item === null) return null;
  const record = item as Record<string, unknown>;
  const name = typeof record['name'] === 'string' ? record['name'] : String(record['display_name'] ?? '').split(',')[0] ?? '';
  const trimmed = name.trim();
  if (!trimmed) return null;
  return {
    name: trimmed,
    normalized: normalizeAddress(trimmed),
    lat: typeof record['lat'] === 'string' ? Number(record['lat']) : null,
    lon: typeof record['lon'] === 'string' ? Number(record['lon']) : null,
    source,
  };
}

/** Убирает дубли по нормализованному имени, сохраняя порядок (сначала наши данные). */
function dedupePlaces<T extends { normalized: string }>(places: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const place of places) {
    if (!place.normalized || seen.has(place.normalized)) continue;
    seen.add(place.normalized);
    result.push(place);
  }
  return result;
}

// ───────────────────────────── HTTP-часть ─────────────────────────────

/** Конверт ответа совпадает с бэкендом: `{ data: … }`. Фронтенд читает именно его. */
function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // CORS: фронтенд живёт на Pages, воркер — на другом домене.
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '86400',
      ...headers,
    },
  });
}

/** Сегодня по Киеву (`YYYY-MM-DD`). */
function kyivToday(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function addDays(date: string, offset: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

interface SlotRow {
  region: string;
  queue: string;
  date: string;
  time_from: string;
  time_to: string;
}

async function loadSlots(env: Env, region: string, date: string): Promise<SlotRow[]> {
  const result = await env.DB.prepare(
    `SELECT region, queue, date, time_from, time_to FROM schedule_slots WHERE region = ? AND date = ?`,
  ).bind(region, date).all<SlotRow>();
  return result.results ?? [];
}

/**
 * Интервалы группы за дату в форме `ScheduleIntervalUtc`, склеенные в окна отключений.
 *
 * Пустой массив означает «по этой группе отключений в этот день нет» — это законное состояние,
 * фронтенд по нему честно покажет «свет будет», а не ошибку.
 */
function toIntervals(rows: SlotRow[], queue: string, date: string) {
  const wanted = normalizeQueue(queue);
  return rows
    .filter((row) => normalizeQueue(row.queue) === wanted)
    .sort((a, b) => a.time_from.localeCompare(b.time_from))
    .map((row) => ({
      startsAt: localSlotToUtc(date, row.time_from, false),
      endsAt: localSlotToUtc(date, row.time_to, true),
      stateCode: OFF_STATE.code,
      stateName: OFF_STATE.name,
      stateColor: OFF_STATE.color,
    }));
}

async function regionSummaries(env: Env): Promise<Array<Record<string, unknown>>> {
  const result = await env.DB.prepare(
    `SELECT region AS cpu, queue, COUNT(*) AS slots, MAX(date) AS lastDate
     FROM schedule_slots GROUP BY region, queue`,
  ).all<{ cpu: string; queue: string; slots: number; lastDate: string | null }>();

  const byRegion = new Map<string, { queues: Set<string>; slots: number; lastDate: string | null }>();
  for (const row of result.results ?? []) {
    const entry = byRegion.get(row.cpu) ?? { queues: new Set<string>(), slots: 0, lastDate: null };
    entry.queues.add(normalizeQueue(row.queue));
    entry.slots += row.slots ?? 0;
    if (row.lastDate && (!entry.lastDate || row.lastDate > entry.lastDate)) entry.lastDate = row.lastDate;
    byRegion.set(row.cpu, entry);
  }

  // Каталог отдаём из встроенных имён, чтобы список областей не исчезал на «холодном» D1.
  const cpus = new Set([...Object.keys(REGION_NAMES), ...byRegion.keys()]);
  return [...cpus].sort().map((cpu) => {
    const entry = byRegion.get(cpu);
    return {
      cpu,
      nameUa: REGION_NAMES[cpu] ?? cpu,
      nameEn: null,
      queues: [...(entry?.queues ?? [])].sort(),
      slots: entry?.slots ?? 0,
      // null, пока область не импортирована. Подставлять сегодняшнюю дату значило бы врать:
      // фронтенд по `lastDate` решает, есть ли график, и увидел бы «есть» у пустой области.
      lastDate: entry?.lastDate ?? null,
      isActive: cpu in REGION_NAMES,
    };
  });
}

async function lastImportedAt(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT updated_at FROM snapshot_meta WHERE key = 'schedule'`).first<{
    updated_at: string;
  }>();
  return row?.updated_at ?? null;
}

/**
 * Единственная точка, где воркер прикасается к данным по запросу.
 *
 * Если D1 ещё пуст (первый запуск до первого крона), график подтягивается с зеркала прямо
 * сейчас и тут же сохраняется — чтобы приложение не было пустым первые 20 минут после деплоя.
 */
async function ensureSchedule(env: Env): Promise<void> {
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM schedule_slots`).first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return;
  const mirror = await fetchMirror(env);
  if (!mirror) return;
  const raw: Slot[] = [];
  for (const item of regionsOf(mirror.payload) ?? []) {
    if (!isJsonObject(item)) continue;
    const cpu = item['cpu'];
    if (typeof cpu === 'string' && cpu) raw.push(...extractSlots(mirror.payload, cpu));
  }
  console.log(`ensureSchedule: зеркало дало ${raw.length} слотов по ${regionsOf(mirror.payload)?.length ?? 0} областям`);
  await ensureSchema(env);
  await saveSlots(env, mergeSlots(raw));
  const written = await env.DB.prepare(`SELECT COUNT(*) AS n FROM schedule_slots`).first<{ n: number }>();
  console.log(`ensureSchedule: в D1 теперь ${written?.n ?? 0} слотов`);
}

/** Обрабатывает один GET-запрос `/api/v1/*`. */



/** Похоже ли название на улицу: OSM в ответе на запрос «улица, село» отдаёт и дома с номерами. */
function isStreetLike(name: string): boolean {
  const value = name.trim();
  if (!value) return false;
  if (/\d+/u.test(value)) return false;
  return /^(вул\.|вулиця|просп\.|проспект|пров\.|провулок|переулок|пер\.|шосе|бульвар|б\.|пл\.|площа|узв\.|ім\.|наб\.|набережна)/iu.test(value);
}

/**
 * Ищет очередь по адресу: сначала конкретный дом, затем вся улица, затем всё село.
 *
 * Порядок именно от точного к общему: чем уже совпадение, тем надёжнее номер группы. Если на
 * улице несколько групп, а дом не указан, номер НЕ угадывается — возвращаются варианты
 * диапазонов, чтобы человек выбрал нужный сам.
 */
async function resolveAddress(
  env: Env,
  input: { region: string; settlement: string; street: string; house: string },
): Promise<{
  queue: string | null;
  reason: 'exact-house' | 'whole-street' | 'whole-settlement' | 'not-found';
  source: string | null;
  options: Array<{ housePattern: string; queue: string }>;
}> {
  const settlementNormalized = normalizeAddress(input.settlement);
  const rows = await env.DB.prepare(
    `SELECT region, settlement_name, settlement_normalized, street_name, street_normalized,
            house_pattern, queue, source, updated_at
     FROM address_queues WHERE region = ? AND settlement_normalized = ?`,
  ).bind(input.region, settlementNormalized).all<AddressQueueRow>();
  const entries = rows.results ?? [];
  if (entries.length === 0) {
    return { queue: null, reason: 'not-found', source: null, options: [] };
  }

  const streetNormalized = normalizeAddress(input.street);
  const wholeSettlement = entries.filter((row) => !row.street_normalized);

  // Уровень 1: конкретный дом на конкретной улице.
  const streetEntries = streetNormalized
    ? entries.filter((row) => row.street_normalized === streetNormalized)
    : [];
  if (streetNormalized && input.house) {
    const exact = streetEntries.find((row) => matchHouseNumber(input.house, row.house_pattern));
    if (exact) {
      return { queue: normalizeQueue(exact.queue), reason: 'exact-house', source: exact.source, options: [] };
    }
  }

  // Уровень 2: вся улица одним номером группы.
  if (streetEntries.length > 0) {
    const distinct = [...new Set(streetEntries.map((row) => normalizeQueue(row.queue)))];
    if (distinct.length === 1) {
      return { queue: distinct[0]!, reason: 'whole-street', source: streetEntries[0]!.source, options: [] };
    }
    // Групп несколько, а дом не указан или в шаблоны не попал — показываем варианты по диапазонам.
    return {
      queue: null,
      reason: 'not-found',
      source: null,
      options: dedupeQueues(streetEntries.map((row) => ({
        housePattern: row.house_pattern === '*' ? row.street_name : `${row.street_name} (${row.house_pattern})`,
        queue: normalizeQueue(row.queue),
      }))),
    };
  }

  // Уровень 3: весь населённый пункт.
  const distinctSettlement = [...new Set(wholeSettlement.map((row) => normalizeQueue(row.queue)))];
  if (distinctSettlement.length === 1) {
    return {
      queue: distinctSettlement[0]!,
      reason: 'whole-settlement',
      source: wholeSettlement[0]!.source,
      options: [],
    };
  }

  return {
    queue: null,
    reason: 'not-found',
    source: null,
    options: dedupeQueues(wholeSettlement.map((row) => ({
      housePattern: row.settlement_name,
      queue: normalizeQueue(row.queue),
    }))),
  };
}

/** Убирает повторы вариантов «дома → очередь», сохраняя порядок. */
function dedupeQueues(options: Array<{ housePattern: string; queue: string }>): Array<{ housePattern: string; queue: string }> {
  const seen = new Set<string>();
  const result: Array<{ housePattern: string; queue: string }> = [];
  for (const option of options) {
    const key = `${option.housePattern}|${option.queue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }
  return result;
}

/**
 * Народная привязка: человек сам называет очередь своего адреса, если её ещё нет в базе.
 *
 * Ограничения на публикацию сознательные:
 *   - очередь должна быть настоящим кодом (1/1…6/2), иначе в базу попадёт мусор;
 *   - сохраняется ОДИН адрес за раз, без имени и телефона — персональных данных не собираем;
 *   - источник помечается `community`, поэтому в интерфейсе видно, что привязка народная,
 *     и её можно перепроверить, а не выдать за выгрузку оператора.
 */
async function handleContribute(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: 'VALIDATION_ERROR', message: 'Очікується JSON' } }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: { code: 'VALIDATION_ERROR', message: 'Очікується об’єкт' } }, 400);
  }

  const payload = body as Record<string, unknown>;
  const region = String(payload['region'] ?? '').trim();
  const settlement = String(payload['settlement'] ?? '').trim();
  const street = String(payload['street'] ?? '').trim();
  const house = String(payload['house'] ?? '').trim();
  const queue = normalizeQueue(String(payload['queue'] ?? ''));

  if (!region || settlement.length < 2) {
    return json({ error: { code: 'VALIDATION_ERROR', message: 'region і settlement обовʼязкові' } }, 400);
  }
  if (!isQueueCode(queue)) {
    return json({ error: { code: 'VALIDATION_ERROR', message: `Невірний код черги «${queue}»` } }, 400);
  }

  const housePattern = house || '*';
  await env.DB.prepare(
    `INSERT OR REPLACE INTO address_queues
       (region, settlement_name, settlement_normalized, street_name, street_normalized,
        house_pattern, queue, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'community', ?)`,
  )
    .bind(
      region,
      settlement,
      normalizeAddress(settlement),
      street,
      normalizeAddress(street),
      housePattern,
      queue,
      new Date().toISOString(),
    )
    .run();

  return json({
    data: { saved: true, queue, source: 'community', housePattern },
  }, 201);
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/v1/u, '').replace(/\/+$/u, '') || '/';
  const region = url.searchParams.get('region') ?? '';
  const today = kyivToday();


  if (path === '/health') {
    return json({ status: 'ok' });
  }

  await ensureSchedule(env);

  if (path === '/regions') {
    const data = await regionSummaries(env);
    // Каталог меняется раз в сутки, а не каждые 20 минут.
    return json({ data }, 200, { 'cache-control': 'public, max-age=300' });
  }

  if (path === '/queues') {
    if (!region) return json({ data: [] });
    const rows = await env.DB.prepare(
      `SELECT queue, COUNT(*) AS slots, MAX(date) AS lastDate
       FROM schedule_slots WHERE region = ? GROUP BY queue ORDER BY queue`,
    ).bind(region).all<{ queue: string; slots: number; lastDate: string | null }>();
    // Списки улиц запрашиваем заранее: await внутри не-async колбэка map невозможен,
    // а последовательные запросы в цикле удлинили бы ответ.
    const list = rows.results ?? [];
    const streetNames = await Promise.all(
      list.map((row) => streetNamesForQueue(env, region, normalizeQueue(row.queue))),
    );
    const data = list.map((row, index) => ({
      queue: normalizeQueue(row.queue),
      slots: row.slots ?? 0,
      lastDate: row.lastDate ?? null,
      // Географию групп (улицы/сёла) зеркало не отдаёт, а выдумывать её нельзя.
      streets: streetNames[index]?.length ?? 0,
      settlements: [],
      // streetNames обязателен: его читает чип мест рядом с выбором группы, и без него
      // компонент падал бы на undefined.map.
      streetNames: streetNames[index] ?? [],
    }));
    return json({ data }, 200, { 'cache-control': 'public, max-age=300' });
  }

  if (path === '/schedules') {
    const queue = normalizeQueue(url.searchParams.get('queue') ?? '');
    const date = url.searchParams.get('date') ?? today;
    if (!queue) return json({ error: { code: 'VALIDATION_ERROR', message: 'queue обовʼязковий' } }, 400);
    const rows = await loadSlots(env, region, date);
    const intervals = toIntervals(rows, queue, date);
    return json({
      data: {
        queue,
        date,
        intervals,
        source: intervals.length > 0 ? 'mirror' : null,
        lastImportedAt: await lastImportedAt(env),
      },
    }, 200, { 'cache-control': 'public, max-age=60' });
  }

  if (path === '/schedules/upcoming') {
    const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days') ?? 2) || 2));
    const regionRows = region
      ? await env.DB.prepare(`SELECT DISTINCT date FROM schedule_slots WHERE region = ? ORDER BY date`)
          .bind(region).all<{ date: string }>()
      : await env.DB.prepare(`SELECT DISTINCT date FROM schedule_slots ORDER BY date`).all<{ date: string }>();

    // Срез только по тем датам, что уже начались или вот-вот начнутся: прошедшие дни человеку
    // не нужны, а тянуть их в приложение незачем.
    const wanted = Array.from({ length: days }, (_, index) => addDays(today, index));
    const dates = (regionRows.results ?? []).map((row) => row.date).filter((date) => wanted.includes(date));

    const buckets: Array<Record<string, unknown>> = [];
    for (const date of dates) {
      const rows = region ? await loadSlots(env, region, date) : [];
      const byQueue = new Map<string, SlotRow[]>();
      for (const row of rows) {
        const key = normalizeQueue(row.queue);
        const list = byQueue.get(key);
        if (list) list.push(row);
        else byQueue.set(key, [row]);
      }
      for (const [queue, queueRows] of byQueue) {
        const intervals = toIntervals(queueRows, queue, date);
        if (intervals.length === 0) continue;
        const nowMs = Date.now();
        buckets.push({
          queue,
          date,
          source: 'mirror',
          intervals,
          isActiveNow: intervals.some(
            (interval) => Date.parse(interval.startsAt) <= nowMs && nowMs < Date.parse(interval.endsAt),
          ),
          nextStartsAt: intervals.find((interval) => Date.parse(interval.startsAt) > nowMs)?.startsAt ?? null,
          settlements: [],
          streetNames: [],
        });
      }
    }

    buckets.sort((a, b) => {
      const dateDiff = String(a.date).localeCompare(String(b.date));
      if (dateDiff !== 0) return dateDiff;
      return String(a.queue).localeCompare(String(b.queue));
    });
    return json({ data: buckets }, 200, { 'cache-control': 'public, max-age=60' });
  }

  if (path === '/news') {
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
    const result = await env.DB.prepare(
      `SELECT id, source_key, url, title, summary, published_at, first_seen_at
       FROM news ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`,
    ).bind(limit).all<NewsRow>();
    const items = (result.results ?? []).map((row) => ({
      id: row.id,
      sourceKey: row.source_key,
      url: row.url,
      title: row.title,
      summary: row.summary ?? null,
      body: row.summary ?? null,
      publishedAt: row.published_at ?? null,
      firstSeenAt: row.first_seen_at,
      regionCpu: null,
      // Вид публикации зеркалом не отдаётся; «ukraine» честнее, чем выдуманный «outage».
      kind: 'ukraine',
      isUkraineWide: true,
      // tags и imageUrls ОБЯЗАТЕЛЬНЫ: по ним компоненты делают .map(). Раньше воркер отдавал
      // несуществующее imageUrl вместо imageUrls — это и ломало рендер вкладки «Новини».
      tags: [],
      imageUrls: [],
      // Хэш содержимого нужен, чтобы не перерисовывать карточку, если текст не изменился.
      // Считаем из того, что реально есть.
      contentHash: `${row.id}:${row.published_at ?? row.first_seen_at}`,
    }));
    const stale = items.length === 0;
    return json({ data: items, meta: { count: items.length, limit, stale } });
  }

  if (path === '/contacts') {
    // Контакты приходят из справочника в D1 (см. schema.sql) — это те же публичные каналы
    // связи, что и в Node-бэкенде: колл-центр, телефоны, боты и приём обращений.
    const rows = await env.DB.prepare(
      `SELECT id, type, label, value, region FROM contacts ORDER BY type, label`,
    ).all<{ id: string; type: string; label: string; value: string; region: string | null }>();
    const data = (rows.results ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      label: row.label,
      value: row.value,
      region: row.region ?? null,
    }));
    return json({ data });
  }

  if (path === '/addresses/settlements') {
    const query = (url.searchParams.get('q') ?? '').trim();
    if (query.length < 2) return json({ data: [] });
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
    const needle = normalizeAddress(query);

    // Сначала наши данные: они проверены и размечены своим источником.
    const ours = await env.DB.prepare(
      `SELECT d.name AS name, d.normalized AS normalized, 'curated' AS source
       FROM directory_settlements d WHERE d.region = ? AND d.normalized LIKE ?`,
    ).bind(region, `%${needle}%`).all<{ name: string; normalized: string; source: 'curated' }>();

    // Тип аннотирован явно: без него TypeScript сужает `source` до литерала 'curated'
    // и не даёт потом положить рядом подсказки из OSM.
    let places: Array<{ name: string; normalized: string; lat: number | null; lon: number | null; source: PlaceSource }> =
      (ours.results ?? []).map((row) => ({
        name: row.name,
        normalized: row.normalized,
        lat: null,
        lon: null,
        source: 'curated',
      }));

    // Статический справочник: города и центры громад ищутся по префиксу в памяти, мгновенно
    // и без сети. Nominatim для них не годится: он требует полное слово, поэтому «Черніг»
    // не находил «Чернігів», а человек именно так и набирает название.
    const fromDirectory = searchSettlements(query, region || undefined, limit);
    for (const hit of fromDirectory) {
      places.push({
        name: hit.name,
        normalized: normalizeAddress(hit.name),
        lat: hit.lat,
        lon: hit.lon,
        source: 'directory',
      });
    }
    places = dedupePlaces(places).slice(0, limit);

    // Хутора и посёлки справочник не покрывает (их десятки тысяч) — их ищем в OSM.
    //
    // Условие обращения к OSM намеренно мягче, чем «справочник пуст»: как только человек
    // дописал хотя бы 4 символа, но совпадений всё ещё мало, мы спрашиваем и OSM. Иначе
    // запрос «Чорн» показывал бы только Чернігів и молчал про село Чорна, а это ровно тот
    // случай, когда человеку нужна подсказка больше всего.
    //
    // Короткие запросы («Че», «Біл») в OSM не спрашиваем: они дают шум и десятки посторонних
    // объектов, а по справочнику ответ и так мгновенный.
    if (places.length === 0 || (query.length >= 4 && places.length < 5)) {
      const osm = await nominatim(
        {
          featuretype: 'settlement',
          // Область в запрос НЕ подставляем: проверено на живых ответах Nominatim, что
          // «Чернігівська область» в запросе ломает поиск («Чернігів, Чернігівська область» —
          // 0 результатов, а «Чернігів» — город). Ограничение страны делает countrycodes=ua,
          // а область сужаем уже фильтром по каталогу регионов на фронтенде.
          q: query,
          // Запас ×3: часть строк отсеется по addresstype (реки, парки, магазины с тем же
          // именем), и без запаса подсказка выходила бы пустой при непустом ответе OSM.
          limit: String(limit * 3),
        },
        SETTLEMENT_ADDRESS_TYPES,
      );
      for (const item of osm) {
        const place = nominatimToPlace(item, 'osm');
        if (place) places.push(place);
      }
    }
    return json({ data: dedupePlaces(places).slice(0, limit) });
  }

  if (path === '/addresses/streets') {
    const settlement = (url.searchParams.get('settlement') ?? '').trim();
    const query = (url.searchParams.get('q') ?? '').trim();
    if (settlement.length < 2) return json({ data: [], wholeSettlementQueue: null });
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
    const settlementNormalized = normalizeAddress(settlement);
    const needle = normalizeAddress(query);

    // Улицы берём из двух мест: справочник (знаем улицу, но не её очередь) и привязки
    // (знаем и улицу, и очередь). Показываем оба — очереди может ещё не быть, и это честно.
    const known = await env.DB.prepare(
      `SELECT name, normalized FROM directory_streets
       WHERE region = ? AND settlement_normalized = ? AND normalized LIKE ?`,
    ).bind(region, settlementNormalized, `%${needle}%`)
      .all<{ name: string; normalized: string }>();

    const bound = await env.DB.prepare(
      `SELECT DISTINCT street_name AS name, street_normalized AS normalized FROM address_queues
       WHERE region = ? AND settlement_normalized = ? AND street_normalized <> '' AND street_normalized LIKE ?`,
    ).bind(region, settlementNormalized, `%${needle}%`)
      .all<{ name: string; normalized: string }>();

    const streets: Array<{ name: string; normalized: string; source: PlaceSource }> = [
      ...(bound.results ?? []).map((row) => ({ name: row.name, normalized: row.normalized, source: 'address_queues' as const })),
      ...(known.results ?? []).map((row) => ({ name: row.name, normalized: row.normalized, source: 'curated' as const })),
    ];

    let places: Array<{ name: string; normalized: string; source: PlaceSource }> = dedupePlaces(streets);

    // Если в нашем справочнике ничего нет (а это большинство сёл) — берём улицы из OSM.
    if (places.length === 0 && query.length >= 2) {
      const osm = await nominatim(
        { q: `${query}, ${settlement}`, limit: String(limit * 3) },
        STREET_ADDRESS_TYPES,
      );
      const mapped: Array<{ name: string; normalized: string; source: PlaceSource }> = [];
      for (const item of osm) {
        const place = nominatimToPlace(item, 'osm');
        // OSM отдаёт и дома, и проезды — оставляем только то, что похоже на улицу.
        if (place && isStreetLike(place.name)) {
          mapped.push({ name: place.name, normalized: place.normalized, source: 'osm' });
        }
      }
      places = dedupePlaces(mapped).slice(0, limit);
    }

    // Если на всё село известна одна очередь — отдаём её, чтобы мастер сразу показал ответ.
    const whole = await env.DB.prepare(
      `SELECT DISTINCT queue FROM address_queues
       WHERE region = ? AND settlement_normalized = ? AND street_normalized = ''`,
    ).bind(region, settlementNormalized).all<{ queue: string }>();
    const queues = [...new Set((whole.results ?? []).map((row) => normalizeQueue(row.queue)))];

    return json({
      data: places,
      wholeSettlementQueue: queues.length === 1 ? queues[0] : null,
      region,
    });
  }

  if (path === '/addresses/resolve') {
    const settlement = (url.searchParams.get('settlement') ?? '').trim();
    if (settlement.length < 2) {
      return json({ error: { code: 'VALIDATION_ERROR', message: 'settlement обовʼязковий' } }, 400);
    }
    const street = (url.searchParams.get('street') ?? '').trim();
    const house = (url.searchParams.get('house') ?? '').trim();

    const resolved = await resolveAddress(env, { region, settlement, street, house });
    if (!resolved.queue) {
      return json({
        data: { queue: null, options: resolved.options, reason: 'not-found', source: null, schedule: null },
      });
    }

    // Расписание найденной группы на сегодня отдаём сразу: человек узнал номер группы и
    // заодно видит, есть ли сейчас свет, не делая второй запрос.
    const rows = await loadSlots(env, region, today);
    const intervals = toIntervals(rows, resolved.queue, today);
    return json({
      data: {
        queue: resolved.queue,
        options: resolved.options,
        reason: resolved.reason,
        source: resolved.source,
        schedule: {
          queue: resolved.queue,
          date: today,
          intervals,
          source: intervals.length > 0 ? 'mirror' : null,
          lastImportedAt: await lastImportedAt(env),
        },
      },
    });
  }

  if (path === '/addresses/contribute') return handleContribute(request, env);

  // Остальные разделы зеркало не отдаёт, и выдумывать их нельзя. Честная пустая выдача:
  // фронтенд на ней показывает свой EmptyState, а не рисует вымышленные отключения.
  if (path === '/outages') {
    const filters = region && region !== 'all' ? 'region = ?' : '1=1';
    const rows = await env.DB.prepare(
      `SELECT external_id, region, starts_at, ends_at, area_name, addresses_raw, reason, kind, source_url
       FROM outage_events WHERE ${filters} AND ends_at >= ? ORDER BY starts_at DESC LIMIT 300`,
    )
      .bind(...(region && region !== 'all' ? [region] : []), new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .all<Record<string, string>>();
    const data = (rows.results ?? []).map((row) => ({
      id: row['external_id']!,
      startsAt: row['starts_at']!,
      endsAt: row['ends_at']!,
      areaName: row['area_name']!,
      addressesRaw: row['addresses_raw']!,
      // Нормализованный адрес считается на бэкенде; здесь отдаём исходный, нормализованный
      // человек всё равно получит при следующем сохранении через адресный мастер.
      addressesNormalized: row['addresses_raw']!,
      streets: [],
      kind: row['kind'] === 'emergency' ? ('repair' as const) : (row['kind'] as 'repair' | 'gpv'),
      reason: row['reason'] ?? null,
      queue: null,
      regionCpu: row['region']!,
      sourceUrl: row['source_url'] ?? null,
    }));
    // Мета пагинации повторяет эталон: page/limit/total/totalPages. Поля count здесь нет —
    // фронтенд его не читает, а лишнее поле сбивало бы с толку при сверке контрактов.
    const limit = Math.min(300, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
    return json({
      data,
      meta: { page, limit, total: data.length, totalPages: Math.max(1, Math.ceil(data.length / limit)) },
    });
  }

  if (path === '/outages/stats') {
    const sinceMonth = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const active = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM outage_events WHERE starts_at <= ? AND ends_at >= ?`,
    ).bind(new Date().toISOString(), new Date().toISOString()).first<{ n: number }>();
    const scheduled = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM outage_events WHERE starts_at > ?`,
    ).bind(new Date().toISOString()).first<{ n: number }>();
    // Разбивки считаем по тем отключениям, что мы реально собрали. Массивы обязаны
    // существовать всегда: компонент тепловой карты делает по ним .map(), и на пустом
    // ответе без них был бы white screen.
    const events = await env.DB.prepare(
      region
        ? `SELECT starts_at, ends_at, area_name FROM outage_events WHERE region = ? AND starts_at >= ?`
        : `SELECT starts_at, ends_at, area_name FROM outage_events WHERE starts_at >= ?`,
    ).bind(...(region ? [region, sinceMonth] : [sinceMonth])).all<{ starts_at: string; ends_at: string; area_name: string }>();

    const byHour = new Map<number, { count: number; minutes: number }>();
    const byDay = new Map<string, { count: number; minutes: number }>();
    const byArea = new Map<string, { count: number; minutes: number }>();
    const heatmap = new Map<number, number>();

    for (const event of events.results ?? []) {
      const startsAt = Date.parse(event.starts_at);
      const endsAt = Date.parse(event.ends_at);
      if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) continue;
      const minutes = Math.round((endsAt - startsAt) / 60_000);
      const hour = new Date(startsAt).getUTCHours();
      const day = event.starts_at.slice(0, 10);
      const area = event.area_name || 'Невідомо';
      // День недели и час идут по UTC — в тепловой карте важна относительная картина,
      // а киевский сдвиг в ней всё равно не читается.
      const dayOfWeek = new Date(startsAt).getUTCDay();

      byHour.set(hour, addBucket(byHour.get(hour), minutes));
      byDay.set(day, addBucket(byDay.get(day), minutes));
      byArea.set(area, addBucket(byArea.get(area), minutes));
      const cell = dayOfWeek * 24 + hour;
      heatmap.set(cell, (heatmap.get(cell) ?? 0) + 1);
    }

    return json({
      data: {
        totalActive: active?.n ?? 0,
        totalScheduled: scheduled?.n ?? 0,
        byHour: [...byHour.entries()].map(([hour, value]) => ({ hour, ...value })).sort((a, b) => a.hour - b.hour),
        byDay: [...byDay.entries()].map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date)),
        byArea: [...byArea.entries()].map(([areaName, value]) => ({ areaName, ...value })).sort((a, b) => a.areaName.localeCompare(b.areaName)),
        heatmap: [...heatmap.entries()].map(([cell, count]) => ({
          dayOfWeek: Math.floor(cell / 24), hour: cell % 24, count,
        })),
      },
    });
  }

  if (path === '/incidents') {
    // Аварийные перерывы (тип 2) показываем отдельным списком: у них есть место и причина,
    // и без них страница «Аварии» была бы пустой.
    const rows = await env.DB.prepare(
      `SELECT external_id, area_name, starts_at, ends_at, reason FROM outage_events
       WHERE kind = 'emergency' AND ends_at >= ? ORDER BY starts_at DESC LIMIT 100`,
    ).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).all<Record<string, string>>();
    const data = (rows.results ?? []).map((row) => ({
      id: row['external_id']!,
      title: row['reason'] ?? 'Аварійна перерва',
      areaName: row['area_name']!,
      startsAt: row['starts_at']!,
      etaAt: row['ends_at']!,
      status: 'open',
    }));
    return json({ data });
  }
  if (path === '/reliability') {
    // Контракт ReliabilityReport: from/to/days/weeks/months/groups. Раньше воркер отдавал
    // несуществующие byBucket/totalGroups и не отдавал обязательные поля, которые читает
    // страница «Надёжность».
    //
    // Считаем честно по собранным данным. Пока отключений оператора нет, окна пустые с
    // hasData:false — это «нет данных», а не «100% надёжности».
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const from = fromDate.toISOString().slice(0, 10);

    const emptyWindow = (windowMinutes: number) => ({
      windowMinutes,
      outageMinutes: 0,
      poweredMinutes: 0,
      reliabilityPct: 0,
      hasData: false,
    });

    // start/end/outageCount обязательны: без них карточки надёжности получают неопределённые
    // значения вместо дат, и интерфейс рисует «Invalid Date».
    const bucket = (key: string, label: string, startIso: string, endIso: string, windowMinutes: number) => ({
      key,
      label,
      start: startIso,
      end: endIso,
      ...emptyWindow(windowMinutes),
      outageCount: 0,
    });

    const monthDays = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const dayStart = `${to}T00:00:00.000Z`;
    const monthStart = `${from}T00:00:00.000Z`;
    const monthEnd = `${to}T23:59:59.999Z`;

    return json({
      data: {
        from,
        to,
        generatedAt: new Date().toISOString(),
        days: [bucket(`day:${to}`, to, dayStart, `${to}T23:59:59.999Z`, 24 * 60)],
        weeks: [bucket(`week:${from}`, from, monthStart, monthEnd, 7 * 24 * 60)],
        months: [bucket(`month:${to.slice(0, 7)}`, to.slice(0, 7), monthStart, monthEnd, daysInMonth * 24 * 60)],
        // По группам считаем по графику ГПВ области — это единственное, что воркер знает
        // о надёжности на сейчас. hasData:false, пока слота по группе нет.
        groups: await reliabilityByQueue(env, region, monthDays * 24 * 60),
      },
    });
  }

  if (path === '/street-queues') return json({ data: [] });
  if (path === '/addresses/suggest') {
    // Раньше здесь был пустой массив, и адресный поиск в облаке не предлагал ничего.
    // Теперь ищем по тому же, что уже есть в D1: справочник улиц и привязки к очередям.
    const query = (url.searchParams.get('q') ?? '').trim();
    const needle = normalizeAddress(query);
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') ?? 8) || 8));
    if (needle.length < 2) return json({ data: [] });

    // Названия колонок у таблиц РАЗНЫЕ, и это уже стоило 500-й ошибки: в address_queues
    // улица лежит в street_name/street_normalized, а в directory_streets — в name/normalized,
    // где ещё и нет колонки с названием села. Поэтому UNION собираем через подзапросы,
    // приводящие обе таблицы к общему виду.
    // Без области фильтровать не по чему, и жёсткое `region = ''` возвращало пустоту:
    // адресная строка в мастере работает ДО выбора области. Поэтому фильтр по области
    // добавляется только тогда, когда область действительно задана.
    // Порядок биндингов обязан совпадать с порядком плейсхолдеров В SQL, а он здесь
    // «LIKE, потом region», а не наоборот. Раньше область подставлялась первым, и при
    // заданном регионе запрос молча возвращал пустоту.
    const whereRegion = region ? 'AND region = ?' : '';
    const whereStreetRegion = region ? 'AND ds.region = ?' : '';
    const bindings: string[] = [`%${needle}%`];
    if (region) bindings.push(region);
    bindings.push(`%${needle}%`);
    if (region) bindings.push(region);
    bindings.push(String(limit));

    const rows = await env.DB.prepare(
      `SELECT name, settlement, normalized FROM (
         SELECT street_name AS name, settlement_name AS settlement, street_normalized AS normalized
         FROM address_queues
         WHERE street_normalized LIKE ? AND street_normalized <> '' ${whereRegion}
       )
       UNION
       SELECT name, settlement, normalized FROM (
         SELECT ds.name AS name, '' AS settlement, ds.normalized AS normalized
         FROM directory_streets ds
         WHERE ds.normalized LIKE ? ${whereStreetRegion}
       )
       LIMIT ?`,
    ).bind(...bindings)
      .all<{ name: string; settlement: string; normalized: string }>();

    const seen = new Set<string>();
    const data = (rows.results ?? [])
      .filter((row) => {
        if (seen.has(row.normalized)) return false;
        seen.add(row.normalized);
        return true;
      })
      .map((row) => ({ name: row.name, normalized: row.normalized, settlement: row.settlement }));

    return json({ data });
  }
  if (path === '/status') {
    // Контракт повторяет StatusResponse из @svitlo/shared. Раньше здесь отдавался другой
    // набор полей (totalOutages/regionsWithData), и главная читала status.grid.level —
    // то есть `undefined.level`, и React падал в белый экран. Поля, которых у нас нет,
    // заполняем честными нулями и null, а НЕ выдумываем значения.
    const totalQueues = await env.DB.prepare(
      `SELECT COUNT(DISTINCT region || '|' || queue) AS n FROM schedule_slots`,
    ).first<{ n: number }>();

    const nowIso = new Date().toISOString();
    const activeOutages = await countActiveOutages(env, region);
    const scheduledOutages = await countScheduledOutages(env, region);
    const activeGroups = await countGroupsOffNow(env, region, today);
    const scheduledGroups = await countGroupsOffLater(env, region, today);
    const importedAt = await lastImportedAt(env);

    // Окно «за добу» и «за 24 години»: считаем по интервалам выбранной области. Пока
    // воркер знает только графики групп, честная надёжность равна доле времени без света.
    const buildWindow = (label: string, windowMinutes: number, rawOutageMinutes: number, outageCount: number) => {
      // Отключение не может занять больше окна: если данные противоречат друг другу,
      // показываем «нет данных», а не отрицательный процент.
      const outageMinutes = Math.min(windowMinutes, Math.max(0, rawOutageMinutes));
      return {
      windowLabel: label,
      windowMinutes,
      outageMinutes,
      poweredMinutes: Math.max(0, windowMinutes - outageMinutes),
      reliabilityPct: windowMinutes > 0 ? Math.round(((windowMinutes - outageMinutes) / windowMinutes) * 1000) / 10 : 0,
      outageCount,
      // Нет ни одного интервала — показать «100% надёжности» было бы выдумкой,
      // поэтому честно помечаем окно как пустое.
      hasData: outageCount > 0,
      };
    };

    const outageMinutesToday = await outageMinutesInWindow(env, region, today);
    const outageMinutes24h = await outageMinutesInWindow(env, region, addDays(today, -1));

    return json({
      data: {
        grid: {
          level: activeOutages > 0 ? 'emergency' : activeGroups > 0 ? 'warning' : 'stable',
          // Сообщение показывается под индикатором, и пустое при «warning» выглядит как
          // ошибка вёрстки, хотя состояние реальное.
          message:
            activeOutages > 0
              ? 'Є аварійні відключення'
              : activeGroups > 0
                ? 'За графіком ГПВ частину груп зараз знеструмлено'
                : '',
        },
        activeOutages,
        scheduledOutages,
        activeGroups,
        scheduledGroups,
        activeIncidents: activeOutages,
        scheduledIncidents: 0,
        totalIncidents: await countIncidents(env),
        lastUpdatedAt: importedAt,
        // Данные старше двух часов помечаем как устаревшие: показывать их как свежие нельзя.
        dataStale: importedAt !== null && Date.now() - Date.parse(importedAt) > 2 * 60 * 60 * 1000,
        lastError: null,
        pausedUntil: null,
        nextAttemptAt: null,
        consecutiveParseFailures: 0,
        powerSummary: {
          today: buildWindow('за добу', 24 * 60, outageMinutesToday, await countOutagesToday(env, region)),
          last24h: buildWindow('за 24 години', 24 * 60, outageMinutes24h, await countOutages24h(env, region)),
        },
        // Служебное: сколько всего групп знает воркер. Фронтенд это поле не читает, но оно
        // нужно для диагностики через curl, поэтому не выбрасываем.
        totalQueues: totalQueues?.n ?? 0,
        generatedAt: nowIso,
      },
    });
  }

  return json({ error: { code: 'NOT_FOUND', message: `Немає маршруту ${path}` } }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight: браузер спрашивает это до любого GET с другого домена.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'Content-Type',
        },
      });
    }

    try {
      return await handleApi(request, env, url);
    } catch (error) {
      // Отвечаем 500 с внятным телом, но без стектрейса наружу: он бесполезен пользователю
      // и может засветить внутренние детали воркера.
      const message = error instanceof Error ? error.message : 'unknown';
      return json({ error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },

  scheduled,
};
