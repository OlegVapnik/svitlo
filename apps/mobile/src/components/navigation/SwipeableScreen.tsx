import { router, usePathname } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { View } from 'react-native';
import type { ReactNode } from 'react';

import { triggerSoftHaptic } from '@/lib/haptics';

const TAB_PATHS = ['/', '/search', '/monitor', '/info'] as const;

/**
 * Горизонтальный свайп между вкладками.
 *
 * Жест живёт только в узких краевых зонах (18 px): полноэкранный Pan перехватывал бы
 * протягивание по 24-часовой шкале и горизонтальные карусели. Свайп от края — тот же
 * системный жест, что и «назад», но здесь он листает вкладки с тактильным откликом.
 */
export function SwipeableScreen({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const index = Math.max(0, TAB_PATHS.indexOf(pathname as (typeof TAB_PATHS)[number]));

  const go = (direction: 1 | -1) => {
    const next = index + direction;
    if (next < 0 || next >= TAB_PATHS.length) return;
    triggerSoftHaptic();
    router.navigate(TAB_PATHS[next]);
  };

  const nextGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onEnd((event) => {
      if (event.translationX < -28) go(1);
    });

  const prevGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onEnd((event) => {
      if (event.translationX > 28) go(-1);
    });

  return (
    <View style={{ flex: 1 }}>
      {children}
      <GestureDetector gesture={prevGesture}>
        <View style={{ position: 'absolute', left: 0, top: 80, bottom: 96, width: 18, zIndex: 20 }} />
      </GestureDetector>
      <GestureDetector gesture={nextGesture}>
        <View style={{ position: 'absolute', right: 0, top: 80, bottom: 96, width: 18, zIndex: 20 }} />
      </GestureDetector>
    </View>
  );
}
