import { useCallback, useEffect, useState } from 'react';

/**
 * Тема оформления: три режима, а не два.
 *
 * Почему «Авто» отдельным режимом, а не просто значением по умолчанию: у человека,
 * который днём ходит со светлой темой (батарея на максимуме ради читаемости на солнце),
 * а ночью — с тёмной (OLED экономит батарею, блики не бьют в глаза), переключать вручную
 * нужно каждый раз. Режим «Авто» берёт системную настройку и следит за её сменой.
 */

const THEME_KEY = 'theme';

/**
 * По умолчанию — тёмная тема: приложение открывают ночью и в темноте, а на AMOLED
 * чистый чёрный физически выключает пиксели. Если у человека в системе выбрана светлая,
 * «Авто» всё равно даст светлую — но явного выбора пользователя мы не перебиваем.
 */
export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_VALUES: Record<ResolvedTheme, string> = { light: '#edefe9', dark: '#050807' };

/** Читаемое сохранённое значение; битое или отсутствующее — «auto». */
function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
  } catch {
    // Приватный режим: хранилище недоступно — считаем, что выбора не было.
    return 'auto';
  }
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'auto' ? (prefersDark() ? 'dark' : 'light') : preference;
}

/** Применяет тему вне React: класс на <html> и цвет строки состояния телефона. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_VALUES[resolved]);
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Хранилище недоступно — тема применится, но не переживёт перезагрузку. Это не повод падать.
  }
  return resolved;
}

/**
 * Хук темы.
 *
 * Первое применение делает инлайн-скрипт в index.html ДО отрисовки: иначе на холодной
 * загрузке страница мигает светлой, а на телефоне цвет строки состояния остаётся от
 * прошлой темы. Событие `svitlo:theme` нужно потому, что хук используют независимо
 * несколько компонентов (переключатель в шапке, графики): без него они разошлись бы по теме.
 *
 * В режиме «Авто» подписываемся на смену системной настройки — переключение темы в
 * системе должно отражаться в приложении сразу, без перезапуска.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readPreference()));

  useEffect(() => {
    setResolved(applyTheme(preference));

    const sync = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail;
      if (next === 'light' || next === 'dark' || next === 'auto') setPreferenceState(next);
    };
    window.addEventListener('svitlo:theme', sync);

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (readPreference() === 'auto') setResolved(applyTheme('auto'));
    };
    media?.addEventListener('change', onSystemChange);

    return () => {
      window.removeEventListener('svitlo:theme', sync);
      media?.removeEventListener('change', onSystemChange);
    };
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    window.dispatchEvent(new CustomEvent<ThemePreference>('svitlo:theme', { detail: next }));
  }, []);

  return { preference, theme: resolved, setPreference };
}
