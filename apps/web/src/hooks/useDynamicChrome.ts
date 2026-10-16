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
  on: '#050807',
  off: '#160b0d',
  unknown: '#0d1110',
};

const TONE_LIGHT: Record<StatusTone, string> = {
  on: '#edefe9',
  off: '#edefe9',
  unknown: '#edefe9',
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
    // Префикс-пиктограмма убрана: эмодзи в заголовке вкладки подменяется системным шрифтом и
    // на Android, и на Windows — вместо узнаваемого значка в списке вкладок появлялся чужой
    // глиф. Статус и без него читается первым словом («Світло є · 2 год · Головна»).
    document.title = parts.length > 0 ? `${parts.join(' · ')} · ${brand}` : brand;
  }, [statusLabel, minutesLabel, t]);
}