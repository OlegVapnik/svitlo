/**
 * Посилання на календар: контракт, який бачать і веб, і застосунок.
 *
 * Перевіряємо рівно те, що ламається: подвійні слеші в базі, кодування `/` у коді черги й
 * коректний `webcal://` без зайвого протоколу.
 */
import { describe, expect, it } from 'vitest';

import { calendarIcsPath, calendarIcsUrl, calendarWebcalUrl } from '../src/lib/calendar-link.ts';

describe('calendar-link', () => {
  it('шлях містить область і закодовану чергу', () => {
    expect(calendarIcsPath('chernihivska-oblast', '2/2')).toBe(
      '/api/v1/calendar.ics?region=chernihivska-oblast&queue=2%2F2',
    );
  });

  it('https-посилання не дублює слеш', () => {
    expect(calendarIcsUrl('https://api.example.com/', 'kyiv', '1/1')).toBe(
      'https://api.example.com/api/v1/calendar.ics?region=kyiv&queue=1%2F1',
    );
  });

  it('webcal-посилання відкидає зайвий протокол, але зберігає хост', () => {
    expect(calendarWebcalUrl('https://api.example.com', 'kyiv', '35/1')).toBe(
      'webcal://api.example.com/api/v1/calendar.ics?region=kyiv&queue=35%2F1',
    );
  });
});
