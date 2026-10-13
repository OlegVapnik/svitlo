/**
 * Парсер публічних веб-прев'ю Telegram-каналів (https://t.me/s/<channel>).
 *
 * Видобуває:
 * - url посту (https://t.me/<channel>/<id>)
 * - опублікований текст
 * - title (перше речення або рядок)
 * - summary та body
 * - published_at (з тегу <time datetime="...">)
 */
import { decodeXmlEntities } from './rss-parser.js';
import { parseDateToUtcIso } from './date-utils.js';
import type { RawParsedNewsItem } from './types.js';

/**
 * Очищає HTML розмітку Telegram-посту до читабельного простого тексту зі збереженням абзаців.
 */
export function cleanTelegramHtml(html: string): string {
  if (!html) return '';

  let text = html;
  // Замінюємо emoji <b> на сам символ емодзі
  text = text.replace(/<i class="emoji"[^>]*><b>([\s\S]*?)<\/b><\/i>/gi, '$1');
  // Замінюємо <br/> на переноси рядків
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Видаляємо всі інші HTML теги
  text = text.replace(/<[^>]+>/g, '');
  // Декодуємо HTML entities (&quot;, &amp;, &#33; тощо)
  text = decodeXmlEntities(text);

  // Нормалізуємо порожні рядки
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, idx, arr) => line !== '' || (idx > 0 && arr[idx - 1] !== ''))
    .join('\n')
    .trim();
}

/**
 * Формує стислий заголовок із тексту повідомлення Telegram.
 */
export function makeTitleFromText(text: string): string {
  if (!text) return '';
  const firstLine = text.split('\n')[0]!.trim();
  if (firstLine.length <= 120) {
    return firstLine;
  }
  // Обрізаємо до найближчого слова біля 100 символів
  const cut = firstLine.slice(0, 110);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * Витягує URL зображень із поста у веб-прев'ю Telegram (t.me/s/<channel>).
 *
 * Чернігівобленерго публікує графіки відключень КАРТИНКАМИ: у прев'ю фото лежить у
 * `background-image:url('https://cdn*.telesco.pe/...')` елемента `tgme_widget_message_photo_wrap`.
 * Раніше ці пости лишались «порожніми» — текст був, а самого графіка в стрічці не було.
 */
export function extractTelegramPhotoUrls(block: string): string[] {
  if (!block) return [];
  const urls: string[] = [];
  // Беремо ВЕСЬ тег <a ...> (не жадібний пошук по документу), щоб url не «перескочив» у сусідній пост.
  const tagRegex = /<a\b[^>]*class="[^"]*tgme_widget_message_photo_wrap[^"]*"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(block)) !== null) {
    const url = /background-image:\s*url\('([^']+)'\)/i.exec(match[0])?.[1];
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/**
 * Розбирає повну HTML-сторінку прев'ю каналу (t.me/s/channel) на список RawParsedNewsItem.
 */
export function parseTelegramChannelHtml(html: string, fallbackChannelUrl?: string): RawParsedNewsItem[] {
  if (!html || typeof html !== 'string') return [];

  const items: RawParsedNewsItem[] = [];

  // Розбиваємо за окремими повідомленнями
  const messageBlocks = html.split(/class="tgme_widget_message_wrap/i);

  for (let i = 1; i < messageBlocks.length; i++) {
    const block = messageBlocks[i]!;

    // Витягуємо посилання та дату
    const dateMatch = /<a\s+class="tgme_widget_message_date"\s+href="([^"]+)">[\s\S]*?<time\s+datetime="([^"]+)"/i.exec(block);
    let postUrl = dateMatch ? dateMatch[1] : null;
    const rawDate = dateMatch ? dateMatch[2] : null;

    if (!postUrl) {
      // Спробуємо знайти data-post
      const dataPostMatch = /data-post="([^"]+)"/i.exec(block);
      if (dataPostMatch && dataPostMatch[1]) {
        postUrl = `https://t.me/${dataPostMatch[1]}`;
      } else if (fallbackChannelUrl) {
        postUrl = fallbackChannelUrl;
      } else {
        continue;
      }
    }

    // Витягуємо текст повідомлення
    const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const rawHtmlText = textMatch ? textMatch[1] : '';
    const cleanText = cleanTelegramHtml(rawHtmlText);

    if (!cleanText) {
      // Повідомлення без тексту (наприклад, суто фото або опитування без підпису) пропускаємо
      continue;
    }

    const title = makeTitleFromText(cleanText);
    const summary = cleanText.length > 250 ? cleanText.slice(0, 240) + '…' : cleanText;
    const publishedAt = parseDateToUtcIso(rawDate);
    const imageUrls = extractTelegramPhotoUrls(block);

    items.push({
      url: postUrl,
      title,
      summary,
      body: cleanText,
      publishedAt,
      imageUrls,
      raw: {
        rawDate,
      },
    });
  }

  return items;
}
