import { describe, expect, test } from 'vitest';
import { classifyTelegramText, TelegramChannelAdapter } from '../../src/parsers/telegram-channel.adapter.js';

describe('Telegram channel adapter', () => {
  test('classifies outage announcements, incidents and general news', () => {
    expect(classifyTelegramText('Графік погодинних відключень на сьогодні')).toBe('outage_schedule');
    expect(classifyTelegramText('Через аварію знеструмлено район')).toBe('incident');
    expect(classifyTelegramText('Виконання ремонтних робіт на обладнанні підстанції')).toBe('incident');
    expect(classifyTelegramText('Вітаємо зі святом')).toBe('news');
  });

  test('extracts Telegram post id, text, date and canonical link', async () => {
    const html = '<div class="tgme_widget_message" data-post="chernigivoblenergo/123"><div class="tgme_widget_message_text">Графік відключень</div><a class="tgme_widget_message_date" href="https://t.me/chernigivoblenergo/123"><time datetime="2026-10-07T10:00:00+00:00"></time></a></div>';
    const fetchStub: typeof fetch = async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    const adapter = new TelegramChannelAdapter(fetchStub);
    const result = await adapter.fetchPosts();
    expect(result.posts[0]).toMatchObject({ id: '123', text: 'Графік відключень', link: 'https://t.me/chernigivoblenergo/123', kind: 'outage_schedule' });
    expect(result.posts[0]?.date.toISOString()).toBe('2026-10-07T10:00:00.000Z');
    expect(result.rawSnapshot).toBe(html);
  });
});
