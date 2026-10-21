import { useLayoutEffect, useRef, useState } from 'react';
import { resolveTabDirection, type TabDirection } from '../lib/tab-transition.js';

/**
 * Мягкий переход между табами: возвращает направление сдвига и признак «контент на месте».
 *
 * ПОЧЕМУ useLayoutEffect. Состояние «ещё не показан» нужно выставить ДО первой отрисовки новой
 * страницы, иначе она успевает мигнуть в полном виде и только потом начинает проявляться —
 * получается двойное появление. useLayoutEffect выполняется между коммитом и отрисовкой.
 *
 * ПОЧЕМУ двойной requestAnimationFrame. Браузер отрисовывает состояние только в конце кадра,
 * поэтому переключение в «показан» тем же кадром не дало бы перехода: начального состояния
 * для интерполяции не существует. Два кадра — гарантия, что «до» уже на экране.
 *
 * Стрелка отмены возвращает кадры назад: при быстром перещёлкивании табов (свайпами подряд)
 * иначе копились бы забытые колбэки, и старый перевёл бы новый экран в «показан» раньше времени.
 */
export interface TabTransition {
  direction: TabDirection;
  /** true — контент доехал и непрозрачен; false — кадр «въезда». */
  entered: boolean;
}

export function useTabTransition(pathname: string): TabTransition {
  const previous = useRef(pathname);
  const [direction, setDirection] = useState<TabDirection>('none');
  // На первой загрузке ничего не анимируем: приложение и так только что открылось.
  const [entered, setEntered] = useState(true);

  useLayoutEffect(() => {
    if (previous.current === pathname) return;
    setDirection(resolveTabDirection(previous.current, pathname));
    previous.current = pathname;
    setEntered(false);

    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });

    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, [pathname]);

  return { direction, entered };
}
