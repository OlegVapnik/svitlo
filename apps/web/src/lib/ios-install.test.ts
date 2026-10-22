import { describe, expect, test } from 'vitest';

import {
  IOS_INSTALL_HINT_KEY,
  IOS_INSTALL_HINT_REPEAT_MS,
  dismissIosInstallHint,
  isIosDevice,
  isIosSafari,
  isStandalonePwa,
  shouldShowIosInstallHint,
  type HintStorage,
  type IosEnvironment,
} from './ios-install.js';

const IPHONE_SAFARI: IosEnvironment = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
};

function memoryStorage(initial: Record<string, string> = {}): HintStorage & {
  values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

describe('iOS install hint', () => {
  test('распознаёт iPhone, iPad и iPadOS в desktop-режиме', () => {
    expect(isIosDevice(IPHONE_SAFARI)).toBe(true);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0)' })).toBe(true);
    expect(
      isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }),
    ).toBe(true);
    expect(
      isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }),
    ).toBe(false);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' })).toBe(false);
  });

  test('не предлагает установку в сторонних браузерах iOS', () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
    expect(
      isIosSafari({ ...IPHONE_SAFARI, userAgent: `${IPHONE_SAFARI.userAgent} CriOS/140.0` }),
    ).toBe(false);
    expect(
      isIosSafari({ ...IPHONE_SAFARI, userAgent: `${IPHONE_SAFARI.userAgent} FxiOS/140.0` }),
    ).toBe(false);
  });

  test('standalone определяется и через navigator.standalone, и через display-mode', () => {
    expect(isStandalonePwa({ ...IPHONE_SAFARI, standalone: true })).toBe(true);
    expect(isStandalonePwa({ ...IPHONE_SAFARI, displayModeStandalone: true })).toBe(true);
    expect(isStandalonePwa(IPHONE_SAFARI)).toBe(false);
  });

  test('показывает подсказку в Safari вне standalone', () => {
    expect(shouldShowIosInstallHint(memoryStorage(), IPHONE_SAFARI, 1_000)).toBe(true);
  });

  test('не показывает в standalone и в чужом браузере', () => {
    expect(
      shouldShowIosInstallHint(memoryStorage(), { ...IPHONE_SAFARI, standalone: true }, 1_000),
    ).toBe(false);
    expect(
      shouldShowIosInstallHint(
        memoryStorage(),
        { ...IPHONE_SAFARI, userAgent: `${IPHONE_SAFARI.userAgent} EdgiOS/140.0` },
        1_000,
      ),
    ).toBe(false);
  });

  test('закрытие скрывает подсказку на 30 дней, затем она возвращается', () => {
    const storage = memoryStorage();
    const now = 1_700_000_000_000;
    dismissIosInstallHint(storage, now);

    expect(storage.values[IOS_INSTALL_HINT_KEY]).toBe(String(now));
    expect(shouldShowIosInstallHint(storage, IPHONE_SAFARI, now + 1_000)).toBe(false);
    expect(
      shouldShowIosInstallHint(storage, IPHONE_SAFARI, now + IOS_INSTALL_HINT_REPEAT_MS - 1),
    ).toBe(false);
    expect(
      shouldShowIosInstallHint(storage, IPHONE_SAFARI, now + IOS_INSTALL_HINT_REPEAT_MS),
    ).toBe(true);
  });

  test('битое значение в хранилище не скрывает подсказку навсегда', () => {
    expect(
      shouldShowIosInstallHint(
        memoryStorage({ [IOS_INSTALL_HINT_KEY]: 'not-a-date' }),
        IPHONE_SAFARI,
        1_000,
      ),
    ).toBe(true);
  });

  test('недоступное хранилище не роняет страницу', () => {
    const broken: HintStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(shouldShowIosInstallHint(broken, IPHONE_SAFARI, 1_000)).toBe(true);
    expect(() => dismissIosInstallHint(broken, 1_000)).not.toThrow();
  });
});
