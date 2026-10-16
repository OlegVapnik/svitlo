import { useCallback, useEffect, useState } from 'react';

/**
 * Тема оформления: ровно две — світла и темна.
 *
 * Почему убран режим «Авто». Он выглядел удобным, но переключатель из-за него состоял из трёх
 * кнопок, и на телефоне шапка (логотип + область + три кнопки) переставала помещаться в ширину
 * экрана — элементы налезали друг на друга. Плюс поведение «само следует за системой» было
 * невидимым: два телефона с одинаковыми настройками выглядели по-разному, и человек не понимал,
 * почему. Одна кнопка «світла/темна» отвечает на один вопрос и не врёт: что выбрано, то и стоит.
 *
 * Старое сохранённое значение 'auto' не выбрасываем: при чтении превращаем его в системную тему
 * и сохраняем как явный выбор (миграция без потери поведения) — см. readPreference.
 */

const THEME_KEY = 'theme';

/**
 * По умолчанию — тёмная тема: приложение открывают ночью и в темноте, а на AMOLED
 * чистый чёрный физически выключает пиксели. Если у человека в системе выбрана светлая,
 * первый запуск всё равно даст тёмную — но дальше решает только его выбор.
 */
export type ThemePreference = 'light' | 'dark';
/** Разрешённая тема совпадает с предпочтением: промежуточного режима больше нет. */
export type ResolvedTheme = ThemePreference;

/**
 * Цвета строки состояния телефона — ровно фон приложения (--md-surface-dim): тёмная тема #09090B
 * (антрацит), светлая #F1F5F9. Держим их здесь, потому что этот хук пишет метку вне React, а
 * инлайн-скрипт в index.html — до первой отрисовки; значение обязано совпадать с палитрой в
 * globals.css, иначе на холодной загрузке полоса мигнёт чужим цветом.
 */
export const THEME_VALUES: Record<ResolvedTheme, string> = { light: '#f1f5f9', dark: '#09090b' };

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/**
 * Читаемое сохранённое значение.
 *
 * 'auto' — наследие прошлых версий: превращаем его в системную тему и тут же сохраняем как
 * явный выбор, чтобы решение не пересчитывалось на каждом запуске (иначе казалось бы, что
 * переключатель снова «сам» переключился).
 */
function readPreference(): ThemePreference {
  const system: ThemePreference = prefersDark() ? 'dark' : 'light';
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    localStorage.setItem(THEME_KEY, system);
    return system;
  } catch {
    // Приватный режим: хранилище недоступно — считаем, что выбора не было.
    return system;
  }
}

/** Применяет тему вне React: класс на <html> и цвет строки состояния телефона. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  document.documentElement.classList.toggle('dark', preference === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_VALUES[preference]);
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Хранилище недоступно — тема применится, но не переживёт перезагрузку. Это не повод падать.
  }
  return preference;
}

/**
 * Хук темы.
 *
 * Первое применение делает инлайн-скрипт в index.html ДО отрисовки: иначе на холодной
 * загрузке страница мигает светлой, а на телефоне цвет строки состояния остаётся от
 * прошлой темы. Событие `svitlo:theme` нужно потому, что хук используют независимо
 * несколько компонентов (кнопка в шапке, графики): без него они разошлись бы по теме.
 *
 * Подписки на смену системной настройки больше нет: тема не «следует за системой», её
 * выбирает человек. Иначе системное переключение ночью молча перебивало бы выбор.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => readPreference());

  useEffect(() => {
    setResolved(applyTheme(preference));

    const sync = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail;
      if (next === 'light' || next === 'dark') setPreferenceState(next);
    };
    window.addEventListener('svitlo:theme', sync);

    return () => {
      window.removeEventListener('svitlo:theme', sync);
    };
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    window.dispatchEvent(new CustomEvent<ThemePreference>('svitlo:theme', { detail: next }));
  }, []);

  return { preference, theme: resolved, setPreference };
}
