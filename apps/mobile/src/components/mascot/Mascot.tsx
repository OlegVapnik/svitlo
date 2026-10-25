import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { triggerSoftHaptic } from '@/lib/haptics';
import { useTheme, type PowerState } from '@/theme/ThemeProvider';

import { pickPhrase, type MascotMood } from './phrases';

// Ассеты підключаємо відносним шляхом: аліас @/ веде в src/, тому ../.. замість @/
const SLEEP_SOURCE = require('../../../assets/mascot/mascot-sleep.png');
const THINK_SOURCE = require('../../../assets/mascot/mascot-think.png');

/** Висота персонажки; ширина — за власним аспектом кожного ассета. */
const IMAGE_HEIGHT = 96;
const IMAGE_ASPECT = { sleep: 275 / 144, think: 264 / 246 } as const;

interface ZzzProps {
  delay: number;
  size: number;
  offsetX: number;
}

/** Одна «z»: спливає вгору й тане; фази зсунуті delay'єм, щоб «z» летіли потоком. */
function Zzz({ delay, size, offsetX }: ZzzProps) {
  const { palette } = useTheme();
  const progress = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.18, 0.7, 1], [0, 1, 0.85, 0]),
    transform: [
      { translateX: offsetX },
      { translateY: -26 * progress.value },
      { scale: 0.75 + 0.45 * progress.value },
    ],
  }));

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1500, easing: Easing.linear }),
          withTiming(0, { duration: 60 }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, progress]);

  return (
    <Animated.Text
      style={[
        {
          position: 'absolute',
          bottom: 0,
          left: 0,
          fontSize: size,
          fontWeight: '700',
          color: palette.primary,
        },
        animatedStyle,
      ]}
    >
      z
    </Animated.Text>
  );
}

/** Сердечко, яке зрідка спливає над маскоткою (цикл ~3.6 с: 1.2 с політ + 2.4 с пауза). */
function Heart() {
  const progress = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 0.8, 1], [0, 1, 0.9, 0]),
    transform: [{ translateY: -32 * progress.value }, { scale: 0.7 + 0.4 * progress.value }],
  }));

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.linear }),
        withTiming(0, { duration: 60 }),
        withTiming(0, { duration: 2400 }),
      ),
      -1,
      false,
    );
  }, [progress]);

  return (
    <Animated.Text
      style={[
        { position: 'absolute', bottom: 0, right: 0, fontSize: 15 },
        animatedStyle,
      ]}
    >
      💚
    </Animated.Text>
  );
}

export interface MascotProps {
  mood: MascotMood;
  powerState: PowerState;
}

/**
 * «Жива» маскотка-чибі: дихає (покачування), над головою спливають «z» (sleep)
 * або зрідка сердечки (think / відомий стан), зліва — хмаринка з фразою.
 * Тап по маскотці показує нову випадкову фразу + м'який хаптик.
 */
export function Mascot({ mood, powerState }: MascotProps) {
  const { palette } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [phrase, setPhrase] = useState(() => pickPhrase(mood, powerState));

  // Дихання: плавний yoyo-цикл ~2.8 с, translateY ±3.5px + rotate ±1.5°
  const breath = useSharedValue(0);
  const breathStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(breath.value, [0, 1], [3.5, -3.5]) },
      { rotate: `${interpolate(breath.value, [0, 1], [-1.5, 1.5])}deg` },
    ],
  }));
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [breath]);

  const source = mood === 'sleep' ? SLEEP_SOURCE : THINK_SOURCE;
  const showZzz = mood === 'sleep';
  // Сердечки: коли маскотка «думає» або стан світла відомий
  const showHeart = mood === 'think' || powerState !== 'unknown';

  const handlePress = useCallback(() => {
    setPhrase((prev) => pickPhrase(mood, powerState, prev));
    triggerSoftHaptic();
  }, [mood, powerState]);

  return (
    <Animated.View entering={FadeIn.duration(320)} style={{ alignSelf: 'center', marginTop: 4 }}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel="Маскот Світло"
        accessibilityHint="Тапни, щоб маскотка сказала нову фразу"
        className="active:opacity-80"
        hitSlop={8}
      >
        <Animated.View style={breathStyle}>
          <View className="flex-row items-center">
            {/* Хмаринка-репліка: переграє FadeIn при зміні фрази (key) */}
            <Animated.View key={phrase} entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)}>
              <View
                style={{
                  backgroundColor: palette.card,
                  borderColor: palette.hairline,
                  // ~62% ширини екрана — щоб хмаринка не розповзалась
                  maxWidth: Math.round(windowWidth * 0.62),
                }}
                className="rounded-2xl border px-3 py-2"
              >
                <Text className="text-xs font-medium leading-4" style={{ color: palette.foreground }}>
                  {phrase}
                </Text>
              </View>
            </Animated.View>

            <View style={{ width: 8 }} />

            {/* Персонажка + частинки над нею (дихають разом з нею) */}
            <View>
              <Image
                source={source}
                style={{ height: IMAGE_HEIGHT, aspectRatio: IMAGE_ASPECT[mood] }}
                resizeMode="contain"
              />
              <View
                pointerEvents="none"
                style={
                  mood === 'sleep'
                    ? { position: 'absolute', left: 4, bottom: 78, width: 96, height: 42 }
                    : { position: 'absolute', right: 0, bottom: 80, width: 56, height: 42 }
                }
              >
                {showZzz ? (
                  <>
                    <Zzz delay={0} size={13} offsetX={6} />
                    <Zzz delay={900} size={17} offsetX={30} />
                    <Zzz delay={1800} size={21} offsetX={52} />
                  </>
                ) : null}
                {showHeart ? <Heart /> : null}
              </View>
            </View>
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
