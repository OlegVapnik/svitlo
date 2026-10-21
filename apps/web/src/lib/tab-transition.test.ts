import { describe, expect, test } from 'vitest';
import { resolveTabDirection, tabIndexOf } from './tab-transition.js';

/**
 * Тест описывает правило перехода, а не реализацию: движение идёт по порядку табов, служебные
 * экраны не двигаются вовсе, а тап и свайп дают одно и то же направление.
 */
describe('tabIndexOf', () => {
  test('адрес таба и его вложенный маршрут — один и тот же таб', () => {
    expect(tabIndexOf('/')).toBe(0);
    expect(tabIndexOf('/search')).toBe(1);
    expect(tabIndexOf('/monitor')).toBe(2);
    expect(tabIndexOf('/info')).toBe(3);
    expect(tabIndexOf('/monitor/outages')).toBe(2);
  });

  test('служебные экраны не принадлежат ни одному табу', () => {
    expect(tabIndexOf('/region')).toBe(-1);
    expect(tabIndexOf('/schedule-import')).toBe(-1);
  });
});

describe('resolveTabDirection', () => {
  test('вправо по панели — следующий таб, влево — предыдущий', () => {
    expect(resolveTabDirection('/', '/search')).toBe('next');
    expect(resolveTabDirection('/monitor', '/info')).toBe('next');
    expect(resolveTabDirection('/info', '/monitor')).toBe('prev');
    expect(resolveTabDirection('/search', '/')).toBe('prev');
  });

  test('шаг через таб сохраняет направление: это тот же порядок панели', () => {
    expect(resolveTabDirection('/', '/monitor')).toBe('next');
    expect(resolveTabDirection('/info', '/search')).toBe('prev');
  });

  test('тот же таб не двигается: подразделы переключаются без сдвига', () => {
    // /monitor → /monitor?tab=outages меняет только query, но проверяем и равные пути.
    expect(resolveTabDirection('/monitor', '/monitor')).toBe('none');
    expect(resolveTabDirection('/monitor/outages', '/monitor')).toBe('none');
  });

  test('служебные экраны переходят без сдвига', () => {
    expect(resolveTabDirection('/', '/region')).toBe('none');
    expect(resolveTabDirection('/schedule-import', '/')).toBe('none');
  });
});
