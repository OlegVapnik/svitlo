import { useEffect, useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { useTheme, type PowerState } from '@/theme/ThemeProvider';

export type WaveTone = Extract<PowerState, 'on' | 'warning' | 'off' | 'unknown'>;

const WAVELENGTH = 28;
const STRIP_HEIGHT = 32;
const STROKE = 3.5;
const AMPLITUDE = 4.5;
/** Ширина полотна волны: шире любого телефона, клип задаёт пройденную часть. */
const WAVE_WIDTH = 1600;

const SPEED: Record<WaveTone, number> = { on: 1.3, warning: 1.8, off: 2.4, unknown: 3 };

/**
 * Одна длинная синусоида из квадратичных кривых. Длина волны кратна 28, поэтому сдвиг
 * на -28 px бесшовно зацикливается.
 */
function wavePath(width: number, amplitude: number): string {
  const mid = STRIP_HEIGHT / 2;
  const quarter = WAVELENGTH / 4;
  const half = WAVELENGTH / 2;
  const control = amplitude * 2;
  let d = `M ${-WAVELENGTH} ${mid}`;
  for (let x = -WAVELENGTH; x < width + WAVELENGTH; x += WAVELENGTH) {
    d += ` Q ${x + quarter} ${mid - control} ${x + half} ${mid}`;
    d += ` Q ${x + half + quarter} ${mid + control} ${x + WAVELENGTH} ${mid}`;
  }
  return d;
}

export interface WavyProgressBarProps {
  /** 0…100: насколько слот уже прошёл. */
  progress: number;
  tone?: WaveTone;
  elapsedLabel?: string;
  remainingLabel?: string;
}

/**
 * Волнистая линия прогресса слота (M3 wavy progress).
 *
 * Пройденная часть течёт синусоидой цвета состояния на UI-потоке (reanimated), остаток —
 * спокойная прямая. На стыке — белая капсула-ползунок. При отключении амплитуда гасится
 * в прямую: «тревога не несётся», а за 15 минут до включения волна оживает.
 */
export function WavyProgressBar({
  progress,
  tone = 'on',
  elapsedLabel,
  remainingLabel,
}: WavyProgressBarProps) {
  const { palette } = useTheme();
  const active = palette.status[tone === 'unknown' ? 'unknown' : tone];
  const clamped = Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const amplitude = tone === 'off' ? 0 : AMPLITUDE;

  const phase = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(phase);
    phase.value = 0;
    phase.value = withRepeat(
      withTiming(-WAVELENGTH, { duration: SPEED[tone] * 1000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
  }, [phase, tone]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: phase.value }],
  }));

  const path = useMemo(() => wavePath(WAVE_WIDTH, amplitude), [amplitude]);

  return (
    <View className="w-full">
      <View style={{ height: STRIP_HEIGHT }} className="relative w-full justify-center">
        <View className="absolute inset-x-0 h-px rounded-full" style={{ backgroundColor: palette.track }} />

        <View
          style={{ width: `${clamped}%`, height: STRIP_HEIGHT, overflow: 'hidden' }}
          className="absolute inset-y-0 left-0"
          pointerEvents="none"
        >
          <Animated.View style={[{ width: WAVE_WIDTH, height: STRIP_HEIGHT }, animatedStyle]}>
            <Svg width={WAVE_WIDTH} height={STRIP_HEIGHT}>
              <Path
                d={path}
                fill="none"
                stroke={active.color}
                strokeWidth={STROKE}
                strokeLinecap="round"
              />
            </Svg>
          </Animated.View>
        </View>

        <View
          style={{
            left: `${clamped}%`,
            width: 2.5,
            height: 20,
            marginLeft: -1.25,
            backgroundColor: '#ffffff',
            borderRadius: 2,
            shadowColor: active.color,
            shadowOpacity: 1,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
            elevation: 6,
          }}
          className="absolute top-1/2 -translate-y-1/2"
        />
      </View>

      {elapsedLabel || remainingLabel ? (
        <View className="mt-2.5 flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {elapsedLabel ? (
            <Text className="text-[11px] font-semibold text-muted-foreground">{elapsedLabel}</Text>
          ) : null}
          {remainingLabel ? (
            <Text className="ml-auto text-right text-[11px] font-semibold text-muted-foreground">
              {remainingLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
