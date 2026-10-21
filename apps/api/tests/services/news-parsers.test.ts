/**
 * Юніт-тести для парсерів новин (RSS та Telegram) і класифікатора.
 * Запускаються повністю без мережі та без БД на збережених фікстурах.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectNewsKind,
  detectRegionCpu,
  extractNewsTags,
  isUkraineWideNews,
} from '../../src/services/news/classifier.js';
import { computeNewsContentHash } from '../../src/services/news/dedup.js';
import { decodeXmlEntities, parseRssOrAtomXml, stripHtmlAndCdata } from '../../src/services/news/rss-parser.js';
import { cleanTelegramHtml, extractTelegramPhotoUrls, makeTitleFromText, parseTelegramChannelHtml } from '../../src/services/news/telegram-parser.js';

const FIXTURES_DIR = resolve(__dirname, '../fixtures/news');

describe('RSS / Atom парсер', () => {
  it('коректно декодує XML entities та очищає CDATA', () => {
    expect(decodeXmlEntities('&quot;Київобленерго&quot; &amp; ДТЕК &apos;2026&apos;')).toBe(
      '"Київобленерго" & ДТЕК \'2026\'',
    );
    expect(stripHtmlAndCdata('<![CDATA[<p>Увага! <b>Графіки</b> оновлено.</p>]]>')).toBe(
      'Увага! Графіки оновлено.',
    );
  });

  it('парсить фікстуру Економічної правди (rss-epravda.xml)', async () => {
    const xml = await readFile(resolve(FIXTURES_DIR, 'rss-epravda.xml'), 'utf8');
    const items = parseRssOrAtomXml(xml);

    expect(items.length).toBeGreaterThan(0);
    const first = items[0]!;
    expect(first.title).toBeTruthy();
    expect(first.url).toMatch(/^https?:\/\//);
    expect(first.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('парсить фікстуру ЧЕline (rss-cheline.xml)', async () => {
    const xml = await readFile(resolve(FIXTURES_DIR, 'rss-cheline.xml'), 'utf8');
    const items = parseRssOrAtomXml(xml);

    expect(items.length).toBeGreaterThan(0);
    const item = items[0]!;
    expect(item.title).toBeTruthy();
    expect(item.url).toMatch(/cheline\.com\.ua/);
    expect(item.publishedAt).toMatch(/Z$/);
  });

  it('парсить фікстуру 0462.ua (rss-0462.xml)', async () => {
    const xml = await readFile(resolve(FIXTURES_DIR, 'rss-0462.xml'), 'utf8');
    const items = parseRssOrAtomXml(xml);

    expect(items.length).toBeGreaterThan(0);
    const item = items[0]!;
    expect(item.title).toBeTruthy();
    expect(item.url).toMatch(/0462\.ua/);
  });
});

describe('Telegram Web Preview парсер', () => {
  it('очищає HTML розмітку та формує заголовок', () => {
    const rawHtml = 'Увага!<br/>За вказівкою НЕК &quot;Укренерго&quot;, введено ГПВ.<br/><br/>Черги 1 та 2.';
    const clean = cleanTelegramHtml(rawHtml);
    expect(clean).toContain('За вказівкою НЕК "Укренерго"');
    const title = makeTitleFromText(clean);
    expect(title).toBe('Увага!');
  });

  it('парсить пости з фікстури Чернігівобленерго (tg-chernigiv.html)', async () => {
    const html = await readFile(resolve(FIXTURES_DIR, 'tg-chernigiv.html'), 'utf8');
    const items = parseTelegramChannelHtml(html, 'https://t.me/chernigivoblenergo');

    expect(items.length).toBeGreaterThan(0);
    const gpvPost = items.find((i) => i.body?.includes('ГПВ') || i.body?.includes('відключен'));
    expect(gpvPost).toBeDefined();
    expect(gpvPost!.url).toMatch(/t\.me\/chernigivoblenergo\/\d+/);
    expect(gpvPost!.publishedAt).toMatch(/Z$/);
  });

  it('витягує URL зображень із поста Telegram (графік картинкою)', () => {
    const block = `
      <a class="tgme_widget_message_photo_wrap blured 123 456" href="https://t.me/chan/1" style="width:533px;background-image:url('https://cdn4.telesco.pe/file/abc.jpg')"></a>
      <a class="tgme_widget_message_photo_wrap" href="https://t.me/chan/1" style="background-image:url('https://cdn4.telesco.pe/file/abc.jpg')"></a>`;
    expect(extractTelegramPhotoUrls(block)).toEqual(['https://cdn4.telesco.pe/file/abc.jpg']);
    expect(extractTelegramPhotoUrls('<div>без фото</div>')).toEqual([]);
  });

  it('додає imageUrls до розібраного поста Telegram', () => {
    const html = `
      <div class="tgme_widget_message_wrap">
        <a class="tgme_widget_message_date" href="https://t.me/chan/7"><time datetime="2026-10-10T10:00:00+00:00"></time></a>
        <div class="tgme_widget_message_text">Графік відключень на завтра</div>
        <a class="tgme_widget_message_photo_wrap blured" href="https://t.me/chan/7" style="background-image:url('https://cdn4.telesco.pe/file/sched.jpg')"></a>
      </div>`;
    const items = parseTelegramChannelHtml(html);
    expect(items).toHaveLength(1);
    expect(items[0]!.imageUrls).toEqual(['https://cdn4.telesco.pe/file/sched.jpg']);
  });

  it('парсить пости з фікстури Укренерго (tg-ukrenergo.html)', async () => {
    const html = await readFile(resolve(FIXTURES_DIR, 'tg-ukrenergo.html'), 'utf8');
    const items = parseTelegramChannelHtml(html, 'https://t.me/ukrenergo');

    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.url).toMatch(/t\.me\/ukrenergo\/\d+/i);
  });

  it('парсить пости з фікстури ДТЕК (tg-dtek.html)', async () => {
    const html = await readFile(resolve(FIXTURES_DIR, 'tg-dtek.html'), 'utf8');
    const items = parseTelegramChannelHtml(html, 'https://t.me/dtek_ua');

    expect(items.length).toBeGreaterThan(0);
  });
});

describe('Класифікатор регіонів та категорій', () => {
  it('розпізнає «Чернігівщина» та чернігівські міста', () => {
    expect(detectRegionCpu('На Чернігівщині через обстріли пошкоджено мережі')).toBe('chernihivska-oblast');
    expect(detectRegionCpu('У Прилуках тривають відновлювальні роботи')).toBe('chernihivska-oblast');
  });

  it('розпізнає «на Львівщині»', () => {
    expect(detectRegionCpu('На Львівщині оновлено графіки погодинних відключень')).toBe('lvivska-oblast');
  });

  it('розрізняє місто Київ та Київську область', () => {
    expect(detectRegionCpu('У Києві відновили електропостачання після аварії')).toBe('kyiv');
    expect(detectRegionCpu('На Київщині діють графіки відключень')).toBe('kiivska-oblast');
    expect(detectRegionCpu('У Київській області пошкоджено підстанцію')).toBe('kiivska-oblast');
  });

  it('повертає null для тексту без регіону', () => {
    expect(detectRegionCpu('Новий генератор встановили на підприємстві')).toBeNull();
  });

  it('визначає is_ukraine_wide для загальнонаціональних новин', () => {
    expect(isUkraineWideNews('Завтра в усіх областях діятимуть графіки відключень')).toBe(true);
    expect(isUkraineWideNews('НЕК Укренерго повідомляє про ситуацію в енергосистемі')).toBe(true);
    expect(isUkraineWideNews('По всій території України введені аварійні відключення')).toBe(true);
    expect(isUkraineWideNews('У Чернігові ремонтують трансформатор')).toBe(false);
  });

  it('визначає правильні категорії (kind)', () => {
    expect(detectNewsKind('Аварійне відключення через ворожий обстріл')).toBe('emergency');
    expect(detectNewsKind('Оприлюднено графік погодинних вимкнень на завтра')).toBe('schedule-change');
    expect(detectNewsKind('Енергетики проводять планові ремонтні роботи')).toBe('repair');
    expect(detectNewsKind('Споживачі залишилися без світла через негоду')).toBe('outage');
    expect(detectNewsKind('Споживання в енергосистемі зменшилось на 5%')).toBe('ukraine');
    expect(detectNewsKind('Відкрито новий центр обслуговування клієнтів')).toBe('other');
  });

  it('витягує теги', () => {
    const tags = extractNewsTags('Оновлено графік ГПВ на Чернігівщині', 'chernihivska-oblast', 'schedule-change');
    expect(tags).toContain('schedule-change');
    expect(tags).toContain('chernihivska-oblast');
    expect(tags).toContain('графік');
  });
});

describe('Дедуплікація новин (content_hash)', () => {
  it('генерує однаковий sha256 хеш для однакових даних незалежно від регістру та пробілів', () => {
    const hash1 = computeNewsContentHash('Увага! Графік', 'https://t.me/chan/1', '2026-10-10T12:00:00Z');
    const hash2 = computeNewsContentHash('  увага!  графік  ', 'HTTPS://T.ME/chan/1', '2026-10-10T12:00:00Z');

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('генерує різні хеші для різних посилань або дат', () => {
    const hash1 = computeNewsContentHash('Графік', 'https://t.me/chan/1', '2026-10-10T12:00:00Z');
    const hash2 = computeNewsContentHash('Графік', 'https://t.me/chan/2', '2026-10-10T12:00:00Z');

    expect(hash1).not.toBe(hash2);
  });
});
