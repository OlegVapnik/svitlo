import { router, usePathname } from 'expo-router';
import { useCallback } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { View } from 'react-native';
import { runOnJS } from 'react-native-reanimated';
import type { ReactNode } from 'react';

import { triggerSelectionHaptic } from '@/lib/haptics';

const TAB_PATHS = ['/', '/search', '/monitor', '/info'] as const;

/** Сам экран не тянется за пальцем — переключаемся с порога дистанции. */
const SWITCH_DISTANCE = 48;
/** Мгновенное переключение и по резкому флику, без ожидания порога дистанции. */
const FLICK_DISTANCE = 16;
const SWITCH_VELOCITY = 400;

/**
 * Горизонтальний свайп між вкладками без анімації полотна.
 *
 * Екран ніколи не рухається: ні по `translateX`, ні по opacity. Живе тільки жест:
 * чистий `Gesture.Pan()` із `hitSlop`, який не конфліктує із системним «Назад», і
 * вертикальним скролом. Щойно ведення досягло порогу дистанції або velocity — миттєво
 * перемикаємо вкладку (0 мс) з тактильним відгуком. Єдина анімація при зміні вкладки —
 * швидкий переліт пігулки в `M3TabBar`.
 *
 * Чому не `<Animated.View>`: Mali/Immortalis (MediaTek) і Adreno (Snapdragon) платять
 * повноекранним FBO-буфером за постійну текстуру, тоді як екран усе одно не рухається.
 * Тому корінь — простий `View`, і `renderToHardwareTextureAndroid` тут доречні.
 */
export function SwipeableScreen({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const index = Math.max(0, TAB_PATHS.indexOf(pathname as (typeof TAB_PATHS)[number]));

  const go = useCallback(
    (direction: 1 | -1) => {
      const next = index + direction;
      if (next < 0 || next >= TAB_PATHS.length) return;
      router.navigate(TAB_PATHS[next]);
    },
    [index]
  );

  const panGesture = Gesture.Pan()
    // hitSlop 24px: не чіпляємо системний жест «Назад» від краю.
    .hitSlop({ left: -24, right: -24 })
    // Активуємо gesture тільки на горизонтальне ведення; вертикальний скрол проходить крізь.
    .activeOffsetX([-22, 22])
    .failOffsetY([-12, 12])
    .onEnd((event) => {
      'worklet';
      const atLeftBoundary = index === 0 && event.translationX > 0;
      const atRightBoundary = index === TAB_PATHS.length - 1 && event.translationX < 0;
      if (atLeftBoundary || atRightBoundary) return;

      const byDistance = Math.abs(event.translationX) > SWITCH_DISTANCE;
      const byFlick = Math.abs(event.velocityX) > SWITCH_VELOCITY && Math.abs(event.translationX) > FLICK_DISTANCE;
      if (!byDistance && !byFlick) return;

      runOnJS(triggerSelectionHaptic)();
      runOnJS(go)(event.translationX < 0 ? 1 : -1);
    });

  return (
    <GestureDetector gesture={panGesture}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}
