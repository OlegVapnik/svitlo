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

/**
 * Единственные два значения: цвет строки состояния совпадает с фоном приложения
 * (--md-surface-dim), и больше ничего.
 *
 * Раньше он следовал за статусом сети: «нет света» красило полосу тёмно-бордовым, «скоро
 * вимкнуть» — коричневым, «світло є» — болотно-зелёным. На телефоне это выглядело как второй
 * экран, спорящий с приложением, и мешало читать сам статус: тревожный цвет полосы ничего не
 * добавлял к бейджу, таймеру и линии прогресса внутри экрана. Запись вида Record сохранена — от
 * неё зависит вызывающий код, а состояние по-прежнему пересчитывает метку при смене темы.
 */
const TONE_COLOR: Record<StatusTone, string> = {
  on: '#09090b',
  off: '#09090b',
  unknown: '#09090b',
};

const TONE_LIGHT: Record<StatusTone, string> = {
  on: '#f1f5f9',
  off: '#f1f5f9',
  unknown: '#f1f5f9',
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