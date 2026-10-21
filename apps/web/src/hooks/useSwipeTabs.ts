import { useCallback, useRef, type TouchEvent as ReactTouchEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveSwipeTarget } from '../lib/swipe-tabs.js';

/**
 * Переключение нижних табов горизонтальным свайпом.
 *
 * ПОЧЕМУ ХУК, А НЕ БИБЛИОТЕКА. Жест выполняет одну задачу — «следующий/предыдущий таб» — и
 * целиком опирается на порядок TAB_ITEMS. Библиотека свайпов добавила бы сюда собственную
 * пружинную физику и конфликт с прокруткой графиков; здесь же 70 строк, которые читаются
 * глазами. Сам расчёт направления — в lib/swipe-tabs.ts, он покрыт тестом.
 *
 * ГДЕ ЖЕСТ НЕ НАШ. Свайп не должен уводить со страницы, если человек листал:
 *   * графики и карты (canvas/svg) — у них своя горизонтальная панорама;
 *   * поля ввода, бегунки, шторки-диалоги — там горизонтальное движение означает другое;
 *   * любой блок с собственной горизонтальной прокруткой (таблицы, ленты) — жест принадлежит ему.
 * Проверка идёт в момент касания (а не в момент отпускания): так мы «отпускаем» жест сразу и не
 * мешаем странице обрабатывать его своими средствами.
 */

/** Внутри этих элементов жест чужой: у них своя панорама, ввод или собственный drag. */
const BLOCKED_SELECTOR =
  'canvas, svg, input, textarea, select, [role="slider"], [role="dialog"], [contenteditable="true"], [data-swipe-ignore]';

/** Идёт ли под пальцем горизонтальная прокрутка (таблица, лента, карусель). */
function hasHorizontalScroll(node: Element | null): boolean {
  for (let current = node; current instanceof HTMLElement; current = current.parentElement) {
    const overflowX = getComputedStyle(current).overflowX;
    if (overflowX === 'auto' || overflowX === 'scroll') return true;
  }
  return false;
}

interface SwipeOrigin {
  x: number;
  y: number;
  /** Жест с самого начала принадлежит другому элементу — листать нельзя. */
  blocked: boolean;
}

export interface SwipeHandlers {
  onTouchStart: (event: ReactTouchEvent) => void;
  onTouchEnd: (event: ReactTouchEvent) => void;
  onTouchCancel: () => void;
}

export function useSwipeTabs(): SwipeHandlers {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const origin = useRef<SwipeOrigin | null>(null);

  const onTouchStart = useCallback((event: ReactTouchEvent) => {
    // Мультитач (щипок, поворот двумя пальцами) — точно не листание.
    if (event.touches.length !== 1) {
      origin.current = null;
      return;
    }
    const touch = event.touches[0];
    const target = event.target instanceof Element ? event.target : null;
    origin.current = {
      x: touch.clientX,
      y: touch.clientY,
      blocked: !target || Boolean(target.closest(BLOCKED_SELECTOR)) || hasHorizontalScroll(target),
    };
  }, []);

  const onTouchEnd = useCallback(
    (event: ReactTouchEvent) => {
      const started = origin.current;
      origin.current = null;
      if (!started || started.blocked) return;

      // changedTouches, а не touches: к моменту touchend палец уже поднят, и в touches его нет.
      const touch = event.changedTouches[0];
      if (!touch) return;

      const target = resolveSwipeTarget(pathname, touch.clientX - started.x, touch.clientY - started.y);
      if (!target) return;

      // Haptic — как при тапе по табу: смена раздела подтверждается, даже если не смотреть.
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10);
      }
      navigate(target);
    },
    [navigate, pathname],
  );

  const onTouchCancel = useCallback(() => {
    origin.current = null;
  }, []);

  return { onTouchStart, onTouchEnd, onTouchCancel };
}
