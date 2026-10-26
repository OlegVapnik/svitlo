import { describe, expect, test } from 'vitest';
import { SWIPE_MIN_DISTANCE, resolveSwipeTarget } from './swipe-tabs.js';

/**
 * Тест описывает правило, а не реализацию: свайп листает нижние табы слева-направо,
 * короткие и косые жесты игнорируются, а служебные экраны не листаются вовсе.
 */
describe('resolveSwipeTarget', () => {
  test('свайп влево ведёт на следующий таб, вправо — на предыдущий', () => {
    expect(resolveSwipeTarget('/', -120, 4)).toBe('/search');
    expect(resolveSwipeTarget('/search', -120, 4)).toBe('/monitor');
    expect(resolveSwipeTarget('/monitor', 120, -4)).toBe('/search');
    expect(resolveSwipeTarget('/search', 120, -4)).toBe('/');
  });

  test('на краях ленты листать некуда', () => {
    expect(resolveSwipeTarget('/', 120, 0)).toBeNull();
    expect(resolveSwipeTarget('/monitor', -120, 0)).toBeNull();
  });

  test('короткий жест — не листание', () => {
    expect(resolveSwipeTarget('/', -(SWIPE_MIN_DISTANCE - 1), 0)).toBeNull();
    expect(resolveSwipeTarget('/', -SWIPE_MIN_DISTANCE, 0)).toBe('/search');
  });

  test('косой жест считаем прокруткой, а не листанием', () => {
    // 80px по горизонтали при 100px по вертикали: человек прокручивал страницу.
    expect(resolveSwipeTarget('/', -80, 100)).toBeNull();
    // 200px по горизонтали при 50px по вертикали — уверенное листание.
    expect(resolveSwipeTarget('/', -200, 50)).toBe('/search');
  });

  test('вложенный маршрут таба листается как сам таб', () => {
    expect(resolveSwipeTarget('/monitor/outages', -120, 0)).toBeNull();
    expect(resolveSwipeTarget('/monitor/outages', 120, 0)).toBe('/search');
    expect(resolveSwipeTarget('/search/streets', 120, 0)).toBe('/');
  });

  test('служебные экраны не листаются: они не табы', () => {
    expect(resolveSwipeTarget('/region', -200, 0)).toBeNull();
    expect(resolveSwipeTarget('/schedule-import', -200, 0)).toBeNull();
  });

  test('нечисловые смещения не ломают решение', () => {
    expect(resolveSwipeTarget('/', Number.NaN, 0)).toBeNull();
    expect(resolveSwipeTarget('/', -120, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
