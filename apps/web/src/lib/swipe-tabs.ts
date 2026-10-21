import { TAB_ITEMS, isNavItemActive } from '../components/layout/nav-items.js';

/**
 * Решение «куда ведёт горизонтальный свайп» — чистый расчёт без DOM.
 *
 * Вынесен отдельно от хука (useSwipeTabs) по двум причинам: проверяется тестом без событий
 * касания, и сам хук остаётся про DOM (какой элемент под пальцем, можно ли вообще листать).
 */

/** Порог, ниже которого движение пальца — не свайп, а дрожь при обычной прокрутке. */
export const SWIPE_MIN_DISTANCE = 56;
/** Во сколько раз горизонталь обязана перевесить вертикаль, чтобы жест считался листанием. */
export const SWIPE_DIRECTION_RATIO = 1.6;

/**
 * Куда ведёт жест. `null` — листать некуда или это не листание:
 *   * смещение меньше порога или жест идёт наискось (человек прокручивал страницу);
 *   * текущий адрес не относится ни к одному табу (служебные экраны — там листать нечего);
 *   * упёрлись в край: с главной вправо или с «Інфо» влево.
 *
 * Влево — следующий таб, вправо — предыдущий: так ведёт себя горизонтальный пейджер
 * (Material ViewPager, лента фотографий), и палец «тащит» содержимое в ту же сторону, куда
 * движется лента. `dy` нужен для отсечения косых жестов.
 */
export function resolveSwipeTarget(pathname: string, dx: number, dy: number): string | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DIRECTION_RATIO) return null;

  const index = TAB_ITEMS.findIndex((item) => isNavItemActive(pathname, item.to));
  if (index === -1) return null;

  const next = TAB_ITEMS[index + (dx < 0 ? 1 : -1)];
  return next ? next.to : null;
}
