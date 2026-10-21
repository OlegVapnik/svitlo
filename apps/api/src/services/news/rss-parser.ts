/**
 * Легковагий та швидкий RSS 2.0 / Atom парсер без зовнішніх залежностей.
 *
 * Видобуває:
 * - title
 * - link / url
 * - description / summary / content:encoded
 * - pubDate / published / updated -> UTC ISO рядок
 */
import { parseDateToUtcIso } from './date-utils.js';
import type { RawParsedNewsItem } from './types.js';

/**
 * Декодує базові XML/HTML ентіті та числові юнікод-символи.
 */
export function decodeXmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    });
}

/**
 * Видаляє CDATA секції та HTML-теги, нормалізуючи пробіли.
 */
export function stripHtmlAndCdata(rawText: string): string {
  if (!rawText) return '';
  let cleaned = rawText.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  cleaned = decodeXmlEntities(cleaned);
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Дістає текст вмісту першого знайденого XML-тегу.
 */
function extractTagContent(block: string, tagName: string): string | null {
  // Шукаємо відкриваючий тег (з атрибутами або без) та закриваючий
  const regex = new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(block);
  if (!match) return null;
  const inner = match[1]!;
  // Якщо всередині CDATA — витягуємо її вміст
  const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(inner);
  if (cdataMatch) {
    return cdataMatch[1]!.trim();
  }
  return decodeXmlEntities(inner.trim());
}

/**
 * Дістає посилання з тегу <link> (підтримує як простий текстовий вузол, так і href="...").
 */
function extractLink(block: string): string | null {
  // Варіант 1: <link href="..." />
  const hrefMatch = /<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  if (hrefMatch && hrefMatch[1]) return hrefMatch[1].trim();

  // Варіант 2: <link>http...</link>
  const textLink = extractTagContent(block, 'link');
  if (textLink) return textLink.trim();

  return null;
}

/**
 * Розбирає XML документ RSS 2.0 або Atom у список RawParsedNewsItem.
 */
export function parseRssOrAtomXml(xml: string): RawParsedNewsItem[] {
  if (!xml || typeof xml !== 'string') return [];

  const items: RawParsedNewsItem[] = [];

  // Шукаємо блоки <item>...</item> (RSS) або <entry>...</entry> (Atom)
  // УВАГА: тут саме ОДИНАРНИЙ бекслеш. Подвійний у regex-літералі матчить літеральний символ,
  // тому жоден <item> не знаходився — RSS-джерела віддавали 0 новин без жодної помилки.
  const itemRegex = /<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]!;

    const rawTitle = extractTagContent(block, 'title') ?? '';
    const title = stripHtmlAndCdata(rawTitle);
    const url = extractLink(block) ?? '';

    if (!title || !url) {
      continue;
    }

    const rawSummary = extractTagContent(block, 'description') ?? extractTagContent(block, 'summary');
    const summary = rawSummary ? stripHtmlAndCdata(rawSummary) : null;

    const rawBody = extractTagContent(block, 'content:encoded') ?? extractTagContent(block, 'content');
    const body = rawBody ? stripHtmlAndCdata(rawBody) : (summary ?? null);

    const rawDate =
      extractTagContent(block, 'pubDate') ??
      extractTagContent(block, 'published') ??
      extractTagContent(block, 'updated') ??
      extractTagContent(block, 'dc:date');

    const publishedAt = parseDateToUtcIso(rawDate);

    items.push({
      url,
      title,
      summary: summary || null,
      body: body || null,
      publishedAt,
      raw: {
        rawDate,
      },
    });
  }

  return items;
}
