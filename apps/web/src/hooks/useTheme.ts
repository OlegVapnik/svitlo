import { useState, useEffect } from 'react';

const THEME_KEY = 'theme';

export type Theme = 'light' | 'dark';

/** Цвет строки состояния/адресной строки на телефоне — совпадает с фоном темы в globals.css. */
const META_COLORS: Record<Theme, string> = { light: '#f3efe6', dark: '#101411' };

/** Применяет тему вне React: класс на <html>, meta theme-color и запись в localStorage. */
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLORS[theme]);
  localStorage.setItem(THEME_KEY, theme);
}

/**
 * Тема приложения. Первое применение делает инлайн-скрипт в index.html (до отрисовки, чтобы
 * на холодной загрузке не мигало светлым), хук доводит состояние дальше.
 * Событие `svitlo:theme` нужно потому, что useTheme вызывают независимо в шапке, в переключателе
 * и в графиках: без него переключатель в шапке и графики разошлись бы по теме.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'));

  useEffect(() => {
    applyTheme(theme);

    const sync = (event: Event) => {
      const next = (event as CustomEvent<Theme>).detail;
      if (next === 'light' || next === 'dark') setThemeState(next);
    };
    window.addEventListener('svitlo:theme', sync);
    return () => window.removeEventListener('svitlo:theme', sync);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    window.dispatchEvent(new CustomEvent<Theme>('svitlo:theme', { detail: next }));
  };
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, setTheme, toggleTheme };
}
