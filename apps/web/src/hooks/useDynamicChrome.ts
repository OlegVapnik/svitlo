import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { THEME_VALUES } from './useTheme';

/**
 * Динамические `<meta name="theme-color">` и заголовок вкладки.
 *
 * ЗАЧЕМ. На телефоне цвет строки состояния виден всегда — он берётся из этой метки.
 * Если он всегда тёплый бежевый, то в тёмной теме строка состояния режет верх экрана
 * светлой полосой, а в светлой — тёмной. Метка следует за темой и статусу сети.
 *
 * Заголовок вкладки отражает ответ на главный вопрос («€ світло · 2 год»), иначе в
 * списке вкладок десяток окон выглядят одинаково. Обновление не чаще раза в 30 секунд:
 * минуты меняются редко, а перерисовка заголовка на каждый тик мельтешит в переключателе.
 */

export type StatusTone = 'on' | 'off' | 'unknown';

const TONE_COLOR: Record<StatusTone, string> = {
  on: '#050507',
  off: '#1a0508',
  unknown: '#0b0b0e',
};

const TONE_LIGHT: Record<StatusTone, string> = {
  on: '#f3efe6',
  off: '#f3efe6',
  unknown: '#f3efe6',
};

export interface DynamicChromeProps {
  status: StatusTone;
  /** Текущая тема оформления — от неё зависит цвет строки состояния. */
  theme: 'light' | 'dark';
  /** Человекочитаемый статус для заголовка, уже переведённый. */
  statusLabel?: string | null;
  /** Минуты до ближайшего события — дописываются в заголовок. */
  minutesLabel?: string | null;
}

export function useDynamicChrome({ status, theme, statusLabel, minutesLabel }: DynamicChromeProps): void {
  const { t } = useTranslation();

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? TONE_COLOR[status] : THEME_VALUES.light);
    }
  }, [status, theme]);

  useEffect(() => {
    const brand = t('nav.home');
    const parts = [statusLabel, minutesLabel].filter(Boolean);
    document.title = parts.length > 0 ? `💡 ${parts.join(' · ')} · ${brand}` : brand;
  }, [statusLabel, minutesLabel, t]);
}