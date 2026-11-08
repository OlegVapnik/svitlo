import { describe, expect, it } from 'vitest';

import { buildCollapsedText } from '../src/lib/notification-preview';
import { notificationColor, NOTIFICATION_PILL } from '../src/lib/notification-banner';
import type { ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';

/**
 * Свёрнутое уведомление — единственный текст, который человек видит не открывая приложение.
 * Ошибка здесь не «косметика»: «Графік ще не опубліковано» при живом отключении выглядит как
 * поломка сервиса. Тесты держат формат «событие · через N» и суффикс очереди.
 */
const window = (overrides: Partial<ScheduleWindow>): ScheduleWindow => overrides as ScheduleWindow;

describe('buildCollapsedText', () => {
  it('без графика — честное «не опубліковано» и очередь', () => {
    expect(buildCollapsedText('unknown', null, '5/1', '2026-10-28')).toEqual({
      title: 'Немає даних',
      body: 'Графік ще не опубліковано · Черга 5/1',
    });
  });

  it('allClear — «відключень немає»', () => {
    const text = buildCollapsedText('allClear', window({}), '2/2', '2026-10-28');
    expect(text.body).toBe('Відключень на добу немає · Черга 2/2');
  });

  it('off: время включения и остаток', () => {
    const text = buildCollapsedText(
      'off',
      window({
        offEndsAt: '2026-10-28T10:30:00.000Z',
        backInMinutes: 72,
        isOff: true,
      }),
      null,
      '2026-10-28',
    );
    expect(text.body).toBe('Увімкнуть о 12:30 · через 1 год 12 хв');
  });

  it('off без времени — только «через»', () => {
    const text = buildCollapsedText('off', window({ backInMinutes: 15, isOff: true }), null, '2026-10-28');
    expect(text.body).toBe('Увімкнуть через 15 хв');
  });

  it('off без данных о времени — общая фраза', () => {
    const text = buildCollapsedText('off', window({ isOff: true }), null, '2026-10-28');
    expect(text.body).toBe('Зараз відключення за графіком');
  });

  it('warning: ближайшее отключение с временем и остатком', () => {
    const text = buildCollapsedText(
      'warning',
      window({ nextStartsAt: '2026-10-28T07:00:00.000Z', nextInMinutes: 45 }),
      '1/1',
      '2026-10-28',
    );
    expect(text.body).toBe('Вимкнуть о 09:00 · через 45 хв · Черга 1/1');
  });

  it('on без следующего окна — «відключень немає»', () => {
    expect(buildCollapsedText('on', window({}), null, '2026-10-28').body).toBe('Відключень на добу немає');
  });
});

describe('notification-banner', () => {
  it('цвет и пилюля заданы для каждого состояния', () => {
    for (const state of ['on', 'off', 'warning', 'allClear', 'unknown'] as const) {
      expect(notificationColor(state)).toMatch(/^#/);
      expect(NOTIFICATION_PILL[state]).toBeTruthy();
    }
  });

  it('off и on не делят цвет', () => {
    expect(notificationColor('off')).not.toBe(notificationColor('on'));
  });
});
