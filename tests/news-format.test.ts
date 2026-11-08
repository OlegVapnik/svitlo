import { describe, expect, it } from 'vitest';
import {
  cleanNewsCardContent,
  formatSourceLabel,
  stripNewsEmoji,
} from '../src/lib/news-format';

describe('news-format', () => {
  it('cleans single-sentence telegram post with emojis and prevents duplicate body', () => {
    const rawPost = '📊 За вказівкою НЕК "Укренерго", маємо зміни у Графіку погодинних відключень (ГПВ) на 30 жовтня ☝️ .';

    // В Telegram коли пост з одного речення, crawler може записати його і як заголовок, і як тіло
    const { title, body } = cleanNewsCardContent(rawPost, rawPost);

    expect(title).toBe('За вказівкою НЕК "Укренерго", маємо зміни у Графіку погодинних відключень (ГПВ) на 30 жовтня.');
    expect(body).toBe('');
  });

  it('strips unicode emojis and cleans whitespace before punctuation', () => {
    expect(stripNewsEmoji('☝️ .')).toBe('.');
    expect(stripNewsEmoji('📅 Повідомлення: відключення 💡 !')).toBe('Повідомлення: відключення!');
    expect(stripNewsEmoji('Графік (ГПВ) ☝️ .')).toBe('Графік (ГПВ).');
    expect(stripNewsEmoji('⚡️ ДТЕК   повідомляє ⚡️')).toBe('ДТЕК повідомляє');
  });

  it('removes duplicate title from body and removes hanging ellipsis', () => {
    const rawTitle = 'За вказівкою НЕК "Укренерго", 1 листопада діятиме графік...';
    const rawBody = 'За вказівкою НЕК "Укренерго", 1 листопада діятиме графік...\n...';

    const { title, body } = cleanNewsCardContent(rawTitle, rawBody);
    expect(title).toBe('За вказівкою НЕК "Укренерго", 1 листопада діятиме графік...');
    expect(body).toBe('');
  });

  it('removes body if remainder after title is shorter than 5 chars or just punctuation', () => {
    const rawTitle = 'Укренерго';
    const rawBody = 'Укренерго - ок';

    const { body } = cleanNewsCardContent(rawTitle, rawBody);
    expect(body).toBe('');
  });

  it('keeps distinct body content without duplicating title prefix', () => {
    const rawTitle = 'Укренерго повідомляє:';
    const rawBody = 'Укренерго повідомляє: завтра з 06:00 до 22:00 діятимуть графіки погодинних відключень по всій країні.';

    const { title, body } = cleanNewsCardContent(rawTitle, rawBody);
    expect(title).toBe('Укренерго повідомляє:');
    expect(body).toBe('завтра з 06:00 до 22:00 діятимуть графіки погодинних відключень по всій країні.');
  });

  it('formats known oblenergo channel handles into human-readable Ukrainian names', () => {
    expect(formatSourceLabel('chernigivoblenergo')).toBe('Чернігівобленерго');
    expect(formatSourceLabel('tg:chernigivoblenergo')).toBe('Чернігівобленерго');
    expect(formatSourceLabel('custom:@chernigivoblenergo')).toBe('Чернігівобленерго');
    expect(formatSourceLabel('lvivoblenergo')).toBe('Львівобленерго');
    expect(formatSourceLabel('pat_cherkasyoblenergo')).toBe('Черкасиобленерго');
    expect(formatSourceLabel('oe_if_ua')).toBe('Прикарпаттяобленерго');
    expect(formatSourceLabel('khmoblenergo')).toBe('Хмельницькобленерго');
    expect(formatSourceLabel('sumyoblenergo')).toBe('Сумиобленерго');
    expect(formatSourceLabel('poltavaoblenergo')).toBe('Полтаваобленерго');
    expect(formatSourceLabel('zoe_com_ua')).toBe('Запоріжжяобленерго');
    expect(formatSourceLabel('ukrenergo')).toBe('Укренерго');
    expect(formatSourceLabel('dtek_ua')).toBe('ДТЕК');
  });

  it('strips standard oblenergo boilerplate tail with chat-bot links', () => {
    const rawTitle = 'За вказівкою НЕК "Укренерго", 29 жовтня в області діятиме графік.';
    const rawBody = `За вказівкою НЕК "Укренерго", 29 жовтня в області діятиме графік.

З 12:00 до 14:00 додатково відключається черга 5/1.

Нагадуємо, що перевірити інформацію щодо черг відключень ГПВ та свій особистий графік можна на нашому сайті https://chernihivoblenergo.com.ua/blackouts або у Telegram-боті tg://resolve?domain=ChernigivOEbot.

Як і раніше, дуже просимо усіх бути максимально ощадливими!`;

    const { title, body } = cleanNewsCardContent(rawTitle, rawBody);
    expect(title).toBe('За вказівкою НЕК "Укренерго", 29 жовтня в області діятиме графік.');
    expect(body).toBe('З 12:00 до 14:00 додатково відключається черга 5/1.');
  });
});
