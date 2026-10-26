import { storage } from '@svitlo/core';
import type { NewsItem } from '@svitlo/shared';

/**
 * Власні джерела новин користувача (RSS/Atom + публічні Telegram-канали).
 * Чиста логіка без React: парсинг рядками/regex (без DOM-парсера), збереження в kv-store.
 * Фетчиться клієнтською стороною — сервер не бере участі.
 */

const STORAGE_KEY = 'mobile.customNewsSources';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_FEED_ITEMS = 20;
const MAX_BODY_LENGTH = 700;
const MAX_TITLE_LENGTH = 90;

export interface CustomNewsSource {
  /** Стабільний id: 'c' + djb2-хеш від нормалізованого URL. */
  id: string;
  type: 'rss' | 'telegram';
  /** rss: абсолютний URL стрічки; telegram: https://t.me/s/<channel>. */
  url: string;
  /** rss — hostname, telegram — '@<channel>'. */
  title: string;
  addedAt: string;
}

export interface NormalizedSourceUrl {
  type: 'rss' | 'telegram';
  url: string;
  title: string;
}

/** djb2 → hex. Достатньо для стабільних id/contentHash без залежностей. */
function djb2(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16);
}

function isCustomSource(value: unknown): value is CustomNewsSource {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CustomNewsSource>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    (candidate.type === 'rss' || candidate.type === 'telegram') &&
    typeof candidate.url === 'string' &&
    /^https?:\/\//i.test(candidate.url) &&
    typeof candidate.title === 'string' &&
    candidate.title.length > 0 &&
    typeof candidate.addedAt === 'string'
  );
}

export function loadCustomSources(): CustomNewsSource[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCustomSource);
  } catch {
    return [];
  }
}

export function saveCustomSources(list: CustomNewsSource[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* сховище недоступне — список просто не запам'ятається */
  }
}

/** Нове джерело з нормалізованого URL: id з хешу + час додавання. */
export function createCustomSource(normalized: NormalizedSourceUrl): CustomNewsSource {
  return {
    id: `c${djb2(normalized.url)}`,
    type: normalized.type,
    url: normalized.url,
    title: normalized.title,
    addedAt: new Date().toISOString(),
  };
}

const CHANNEL_NAME_RE = /^[A-Za-z0-9_]{4,32}$/;

/**
 * Розпізнає ввід користувача: '@name', 't.me/name', 'https://t.me/s/name', 'telegram.me/…'
 * → telegram; інші http(s)-URL → RSS. Інакше null.
 */
export function normalizeSourceUrl(input: string): NormalizedSourceUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Форма '@name'
  if (trimmed.startsWith('@')) {
    const name = trimmed.slice(1);
    if (!CHANNEL_NAME_RE.test(name)) return null;
    return { type: 'telegram', url: `https://t.me/s/${name}`, title: `@${name}` };
  }

  // 't.me/name', 't.me/s/name', 'telegram.me/…' — без протоколу
  const bare = /^(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]+)\/?$/i.exec(trimmed);
  if (bare) {
    const name = bare[1] ?? '';
    if (!CHANNEL_NAME_RE.test(name)) return null;
    return { type: 'telegram', url: `https://t.me/s/${name}`, title: `@${name}` };
  }

  const withProtocol = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(trimmed);
  if (!withProtocol) return null;

  const host = (withProtocol[1] ?? '').toLowerCase();
  const path = withProtocol[2] || '/';

  // https://t.me/name або https://t.me/s/name
  if (host === 't.me' || host === 'telegram.me') {
    const channel = /^\/(?:s\/)?([A-Za-z0-9_]+)\/?$/i.exec(path);
    const name = channel?.[1] ?? '';
    if (!CHANNEL_NAME_RE.test(name)) return null;
    return { type: 'telegram', url: `https://t.me/s/${name}`, title: `@${name}` };
  }

  // Усе інше з http(s) вважаємо RSS/Atom-стрічкою; трейліг-слеші обрізаємо.
  const url = trimmed.replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#]+/i.test(url)) return null;
  return { type: 'rss', url, title: host };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

/** Мінімум HTML-ентітів: іменовані + числові десяткові/шістнадцяткові. */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&#(x[0-9a-fA-F]+|[0-9]+);|&([a-zA-Z][a-zA-Z0-9]*);/g, (match, numeric, named) => {
    if (typeof numeric === 'string' && numeric.length > 0) {
      const hex = numeric[0] === 'x' || numeric[0] === 'X';
      const code = Number.parseInt(hex ? numeric.slice(1) : numeric, hex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    if (typeof named === 'string') return NAMED_ENTITIES[named] ?? match;
    return match;
  });
}

/**
 * Прибирає теги, розкодовує сутності та схлопує пробіли в один рядок.
 * Два проходи: XML-екрановані теги (&lt;p&gt;) після decode самі стають тегами й прибираються,
 * а подвійне екранування (&amp;#39;) розкодовується до кінця.
 */
export function stripHtml(input: string): string {
  const tagsToSpace = (text: string) =>
    text
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li)>/gi, ' ')
      .replace(/<[^>]*>/g, '');
  return decodeHtmlEntities(tagsToSpace(decodeHtmlEntities(tagsToSpace(input))))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Витягує вміст <![CDATA[…]]>, якщо є; інакше повертає вхід як є. */
export function extractCdata(input: string): string {
  const match = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(input);
  return match ? (match[1] ?? '') : input;
}

/** fetch з AbortController-таймаутом — як у решті клієнтських запитів проєкту. */
export async function fetchWithTimeout(url: string, ms: number = FETCH_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/html;q=0.9, */*;q=0.8',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Вміст першого тега <tag …>…</tag> у блоці (без CDATA-обробки). */
function tagContent(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match ? (match[1] ?? null) : null;
}

/** Усі блоки <tag>…</tag> (регістронезалежно). */
function tagBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  for (const match of xml.matchAll(pattern)) blocks.push(match[1] ?? '');
  return blocks;
}

/** Посилання з Atom-<link …/>: rel="alternate", інакше перший із href. */
function atomLink(block: string): string | null {
  let first: string | null = null;
  for (const match of block.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1] ?? '';
    const href = /href="([^"]+)"/i.exec(attrs)?.[1];
    if (!href) continue;
    if (first === null) first = decodeHtmlEntities(href);
    const rel = /rel="([^"]*)"/i.exec(attrs)?.[1];
    if (rel === 'alternate') return decodeHtmlEntities(href);
  }
  return first;
}

function toIsoOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const time = Date.parse(raw.trim());
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Свіжіші вище, записи без дати — вниз. */
function byDateDesc(a: { publishedAt: string | null }, b: { publishedAt: string | null }): number {
  if (a.publishedAt === null && b.publishedAt === null) return 0;
  if (a.publishedAt === null) return 1;
  if (b.publishedAt === null) return -1;
  return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
}

function toNewsItem(
  source: CustomNewsSource,
  url: string,
  title: string,
  body: string,
  publishedAt: string | null,
  imageUrls: string[],
): NewsItem {
  return {
    id: `${source.id}:${djb2(url)}`,
    sourceKey: `custom:${source.title}`,
    url,
    title,
    summary: null,
    body,
    publishedAt,
    firstSeenAt: new Date().toISOString(),
    regionCpu: null,
    kind: 'other',
    isUkraineWide: false,
    tags: [],
    imageUrls,
    contentHash: djb2(`${source.id}:${url}`),
  };
}

/**
 * RSS 2.0 (<item>) або Atom (<entry>, якщо item'ів немає).
 * title — CDATA + сутності; body — description/summary без тегів; ліміт 20, свіжі зверху.
 */
export function parseRssFeed(xml: string, source: CustomNewsSource): NewsItem[] {
  const rssItems = tagBlocks(xml, 'item');
  const entries = rssItems.length > 0 ? rssItems : tagBlocks(xml, 'entry');

  const parsed = entries
    .map((block) => {
      const rssLink = tagContent(block, 'link')?.trim();
      const link = rssLink ? decodeHtmlEntities(rssLink) : atomLink(block);
      const title = stripHtml(extractCdata(tagContent(block, 'title') ?? ''));
      const body = truncate(
        stripHtml(extractCdata(tagContent(block, 'description') ?? tagContent(block, 'summary') ?? '')),
        MAX_BODY_LENGTH,
      );
      const publishedAt = toIsoOrNull(
        tagContent(block, 'pubDate') ?? tagContent(block, 'published') ?? tagContent(block, 'updated'),
      );
      return { link, title, body, publishedAt };
    })
    .filter((entry) => Boolean(entry.link));

  parsed.sort(byDateDesc);

  return parsed.slice(0, MAX_FEED_ITEMS).map((entry) =>
    toNewsItem(
      source,
      entry.link as string,
      entry.title || truncate(entry.body, MAX_TITLE_LENGTH) || 'Без назви',
      entry.body,
      entry.publishedAt,
      [],
    ),
  );
}

/**
 * Публічна сторінка https://t.me/s/<name>: пости в блоках tgme_widget_message_wrap.
 * Курсивні/закриті канали сторінку без постів — тоді кидаємо помилку.
 */
export function parseTelegramChannel(html: string, source: CustomNewsSource): NewsItem[] {
  const chunks = html.split('<div class="tgme_widget_message_wrap').slice(1);

  const posts = chunks
    .map((chunk) => {
      const postMatch = /data-post="([^"/]+)\/(\d+)"/.exec(chunk);
      const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(chunk);
      if (!postMatch || !textMatch) return null;

      const text = stripHtml(extractCdata(textMatch[1] ?? ''));
      if (!text) return null;

      const timeMatch = /<time\b[^>]*\sdatetime="([^"]+)"/i.exec(chunk);
      const photoMatch = /background-image:url\('([^']+)'\)/i.exec(chunk);
      const [, channel = '', postId = ''] = postMatch;

      return {
        url: `https://t.me/${channel}/${postId}`,
        title: truncate(text, MAX_TITLE_LENGTH),
        body: truncate(text, MAX_BODY_LENGTH),
        publishedAt: toIsoOrNull(timeMatch?.[1]),
        photo: photoMatch?.[1] ?? null,
      };
    })
    .filter((post): post is NonNullable<typeof post> => post !== null);

  if (posts.length === 0) {
    throw new Error('Канал недоступний або не існує');
  }

  posts.sort(byDateDesc);

  return posts.map((post) =>
    toNewsItem(source, post.url, post.title, post.body, post.publishedAt, post.photo ? [post.photo] : []),
  );
}

/**
 * Кеш останньої вдалої стрічки власних джерел у kv-store. Читається на холодному старті
 * (initialData запиту), щоб пості були видимі одразу, до першого клієнтського фетчу.
 */
const CACHE_KEY = 'mobile.customNewsCache';
/** 30 хв — скільки кеш вважається свіжим для холодного старту. */
export const CUSTOM_NEWS_CACHE_TTL_MS = 30 * 60_000;

export interface CustomNewsCache {
  items: NewsItem[];
  savedAt: number;
}

/** Остання вдала стрічка власних джерел; null — кешу немає або він пошкоджений. */
export function loadCustomNewsCache(): CustomNewsCache | null {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<CustomNewsCache>;
    if (!Array.isArray(candidate.items) || typeof candidate.savedAt !== 'number') return null;
    return { items: candidate.items, savedAt: candidate.savedAt };
  } catch {
    return null;
  }
}

/** Зберегти стрічку з поточним timestamp — викликається після кожної вдалої збірки. */
export function saveCustomNewsCache(items: NewsItem[]): void {
  try {
    const cache: CustomNewsCache = { items, savedAt: Date.now() };
    storage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* сховище недоступне — кеш просто не збережеться */
  }
}

/** Завантажує й розбирає одне джерело; помилки мережі/парсингу йдуть нагору зі зрозумілим текстом. */
export async function fetchCustomSource(source: CustomNewsSource): Promise<NewsItem[]> {
  let payload: string;
  try {
    payload = await fetchWithTimeout(source.url);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Джерело не відповідає (таймаут)');
    }
    throw new Error('Не вдалося завантажити джерело');
  }
  return source.type === 'telegram' ? parseTelegramChannel(payload, source) : parseRssFeed(payload, source);
}
