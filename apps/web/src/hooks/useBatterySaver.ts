import { useEffect, useState } from 'react';

/**
 * Режим «Економія заряду»: гасит анимации и свечение, когда батарея на последних процентах.
 *
 * Почему автоматически. Свет отключают вечером, и человек в этот момент чаще всего держит
 * телефон в руке на низком заряде. Анимированное свечение и перерисовки — ровно то, что
 * в такой момент дороже всего, а пользы ноль. Экономия тут не «красивая галочка», а
 * несколько дополнительных минут работы.
 *
 * API батареи есть не везде (и в iOS Safari его не будет никогда), поэтому отсутствие
 * `getBattery` — это штатная ситуация, а не ошибка: режим просто не включается.
 */

const SAVER_KEY = 'svitlo:battery-saver';
/** Ниже этого уровня включаем экономию. */
const LOW_LEVEL = 0.2;

function readSaved(): boolean {
  try {
    return localStorage.getItem(SAVER_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSaved(value: boolean): void {
  try {
    localStorage.setItem(SAVER_KEY, value ? '1' : '0');
  } catch {
    // Приватный режим — просто не запомним настройку.
  }
}

interface BatteryManagerLike {
  level: number;
  addEventListener(type: 'levelchange', listener: () => void): void;
  removeEventListener(type: 'levelchange', listener: () => void): void;
}

export function useBatterySaver(): { enabled: boolean; supported: boolean; setEnabled: (value: boolean) => void } {
  const [enabled, setEnabledState] = useState(readSaved);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (typeof nav.getBattery !== 'function') {
      setSupported(false);
      return;
    }
    setSupported(true);

    let battery: BatteryManagerLike | undefined;
    let cancelled = false;

    const apply = (level: number) => {
      // Ручной выбор имеет приоритет над автоматикой: если человек выключил экономию
      // сам, «зарядка села» не должна включать её обратно.
      if (readSaved()) return;
      setEnabledState(level <= LOW_LEVEL);
    };

    const onChange = () => {
      if (battery) apply(battery.level);
    };

    nav
      .getBattery()
      .then((manager) => {
        if (cancelled) return;
        battery = manager;
        apply(manager.level);
        manager.addEventListener('levelchange', onChange);
      })
      .catch(() => setSupported(false));

    return () => {
      cancelled = true;
      battery?.removeEventListener('levelchange', onChange);
    };
  }, []);

  // Класс на <html>, чтобы отключить всё разом, а не по месту: иначе пришлось бы
  // перечислять каждый анимированный компонент.
  useEffect(() => {
    document.documentElement.classList.toggle('battery-saver', enabled);
  }, [enabled]);

  const setEnabled = (value: boolean) => {
    setEnabledState(value);
    writeSaved(value);
  };

  return { enabled, supported, setEnabled };
}