import { describe, expect, it } from 'vitest';

import { buildWidgetPayload, type WidgetPlaceSnapshot } from '../src/lib/widget-payload';
import type { NotificationBanner } from '../src/lib/notification-banner';

/**
 * Контракт JS ↔ Kotlin: `WidgetPayload.kt` читает ровно эти имена полей.
 *
 * Ошибка здесь не падает в тестах приложения — она видна человеку как «немає даних» на
 * домашнем экране после обновления. Поэтому снимок проверяем целиком: и состав ключей,
 * и значения по краевым состояниям (нет графика, свет есть, отключение).
 */

const banner = (overrides: Partial<NotificationBanner> = {}): NotificationBanner => ({
  state: 'on',
  pill: 'За графіком',
  headline: 'Світло є',
  detail: '',
  timer: { prefix: 'до', value: '2 год 10 хв' },
  queue: '5/1',
  slots: [1, 1, 3, null],
  nowFraction: 0.42,
  offMinutes: 120,
  date: '2026-10-29',
  clockTime: '12:30',
  offRanges: ['09:30–11:30'],
  event: null,
  collapsed: { title: 'Світло є', body: 'до 14:40' },
  ...overrides,
});

const place = (overrides: Partial<WidgetPlaceSnapshot> = {}): WidgetPlaceSnapshot => ({
  icon: '🏠',
  label: 'Дім',
  queue: '6/1',
  state: 'on',
  timeLabel: 'до 09:00',
  statusText: 'Світло є',
  ...overrides,
});

describe('buildWidgetPayload', () => {
  it('отдаёт все поля, которые ждёт нативный виджет', () => {
    const payload = buildWidgetPayload(banner(), undefined, 1700000000000);
    expect(Object.keys(payload).sort()).toEqual([
      'detail',
      'headline',
      'nowFraction',
      'offMinutes',
      'pill',
      'placeLabel',
      'places',
      'progress',
      'queue',
      'queueLabel',
      'slots',
      'state',
      'timer',
      'timerPrefix',
      'todayOffMinutes',
      'tomorrowOffMinutes',
      'updatedAt',
      'windowsToday',
      'windowsTomorrow',
    ]);
    expect(payload.updatedAt).toBe(1700000000000);
    expect(payload.slots).toEqual([1, 1, 3, null]);
    expect(payload.nowFraction).toBeCloseTo(0.42);
  });

  it('без extras не выдумывает нули: «нет данных» — это null, а не 0', () => {
    const payload = buildWidgetPayload(banner(), undefined, 1);
    expect(payload.todayOffMinutes).toBeNull();
    expect(payload.tomorrowOffMinutes).toBeNull();
    expect(payload.progress).toBeNull();
    expect(payload.places).toEqual([]);
    expect(payload.placeLabel).toBe('Мій графік');
    expect(payload.queueLabel).toBe('5/1');
    expect(payload.windowsToday).toEqual([]);
    expect(payload.windowsTomorrow).toEqual([]);
  });

  it('при свете без таймера пишет «Світло є», при отключении — «—»', () => {
    expect(buildWidgetPayload(banner({ timer: null, state: 'on' }), undefined, 1).timer).toBe('Світло є');
    expect(buildWidgetPayload(banner({ timer: null, state: 'allClear' }), undefined, 1).timer).toBe('Світло є');
    expect(buildWidgetPayload(banner({ timer: null, state: 'off' }), undefined, 1).timer).toBe('—');
    expect(buildWidgetPayload(banner({ timer: null, state: 'unknown' }), undefined, 1).timer).toBe('—');
  });

  it('сохраняет таймер с префиксом и пустую очередь как пустую строку', () => {
    const payload = buildWidgetPayload(banner({ timer: { prefix: 'через', value: '35 хв' }, queue: null }), undefined, 1);
    expect(payload.timerPrefix).toBe('через');
    expect(payload.timer).toBe('35 хв');
    expect(payload.queue).toBe('');
  });

  it('прокидывает места «Радара» и минуты без света как есть', () => {
    const payload = buildWidgetPayload(
      banner({ state: 'off' }),
      {
        placeLabel: '🏠 Дім · 6/1',
        todayOffMinutes: 240,
        tomorrowOffMinutes: 0,
        progress: 55,
        places: [place(), place({ icon: '💼', label: 'Робота', state: 'off', statusText: 'Вимкнено' })],
      },
      42,
    );
    expect(payload.placeLabel).toBe('🏠 Дім · 6/1');
    expect(payload.todayOffMinutes).toBe(240);
    // Ноль — это «графік є, відключень немає», его нельзя превращать в null.
    expect(payload.tomorrowOffMinutes).toBe(0);
    expect(payload.progress).toBe(55);
    expect(payload.places).toHaveLength(2);
    expect(payload.places[1]?.statusText).toBe('Вимкнено');
  });

  it('сериализуется в JSON без undefined — нативный парсер ждёт полный объект', () => {
    const serialized = JSON.stringify(buildWidgetPayload(banner({ queue: null, detail: undefined as unknown as string }), undefined, 7));
    expect(serialized).not.toContain('undefined');
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.detail).toBe('');
    expect(parsed.queue).toBe('');
    expect(parsed.places).toEqual([]);
  });
});

describe('место и очередь в снимке раздельно', () => {
  it('queueLabel приходит из extras, а не склеивается с названием места', () => {
    const payload = buildWidgetPayload(
      banner({ queue: '6/1' }),
      {
        placeLabel: '🏠 Дім',
        queueLabel: '35/1',
        todayOffMinutes: 60,
        tomorrowOffMinutes: null,
        places: [],
      },
      1,
    );
    expect(payload.placeLabel).toBe('🏠 Дім');
    expect(payload.queueLabel).toBe('35/1');
  });

  it('без выбранного места queueLabel падает на очередь из плашки', () => {
    const payload = buildWidgetPayload(
      banner({ queue: '44/1' }),
      { placeLabel: 'Мій графік', todayOffMinutes: null, tomorrowOffMinutes: null, places: [] },
      1,
    );
    expect(payload.queueLabel).toBe('44/1');
  });

  it('окна суток доезжают до Kotlin без потерь', () => {
    const payload = buildWidgetPayload(
      banner(),
      {
        placeLabel: 'Дім',
        queueLabel: '3/1',
        todayOffMinutes: 120,
        tomorrowOffMinutes: 60,
        windowsToday: [
          [1000, 2000],
          [3000, 4000],
        ],
        windowsTomorrow: [[5000, 6000]],
        places: [],
      },
      1,
    );
    expect(payload.windowsToday).toEqual([
      [1000, 2000],
      [3000, 4000],
    ]);
    expect(payload.windowsTomorrow).toEqual([[5000, 6000]]);
  });
});
