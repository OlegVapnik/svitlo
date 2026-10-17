import { afterEach, describe, expect, test, vi } from 'vitest';
import { hapticTick } from './haptics.js';

/**
 * Тактильный отклик — необязательный акцент, поэтому проверяем не «вибрирует ли телефон»,
 * а порядок путей: нативный мост важнее браузерного API, а отказ любого из них не должен
 * ломать обработчик нажатия.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('hapticTick', () => {
  test('в APK используется нативный мост, а не navigator.vibrate', () => {
    const vibrateTick = vi.fn();
    const vibrate = vi.fn();
    vi.stubGlobal('window', { SvitloHaptics: { vibrateTick } });
    vi.stubGlobal('navigator', { vibrate });

    hapticTick('confirm');

    expect(vibrateTick).toHaveBeenCalledWith('confirm');
    expect(vibrate).not.toHaveBeenCalled();
  });

  test('в браузере — короткий импульс navigator.vibrate(8)', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { vibrate });

    hapticTick('tick');

    expect(vibrate).toHaveBeenCalledWith(8);
  });

  test('отказ нативного моста уводит в браузерную ветку, а не роняет нажатие', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('window', {
      SvitloHaptics: {
        vibrateTick: () => {
          throw new Error('bridge unavailable');
        },
      },
    });
    vi.stubGlobal('navigator', { vibrate });

    expect(() => hapticTick('select')).not.toThrow();
    expect(vibrate).toHaveBeenCalledWith(12);
  });

  test('без window (SSR/тесты) молчит и не бросает', () => {
    vi.stubGlobal('window', undefined);
    expect(() => hapticTick()).not.toThrow();
  });

  test('нет ни моста, ни vibrate — просто ничего не происходит', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
    expect(() => hapticTick('tick')).not.toThrow();
  });
});
