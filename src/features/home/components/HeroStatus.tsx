import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import {
  formatMinutesUk,
  minutesOfDay,
  minutesToHm,
  slotProgress,
  type ScheduleWindow,
} from '@svitlo/core/lib/scheduleWindow';
import { heroNotice, waveToneOf } from '@svitlo/core/lib/day-status';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import { StatusPill } from '@/components/ui/StatusPill';
import { WavyProgressBar, type WaveTone } from '@/components/ui/WavyProgressBar';
import { useTheme, type PowerState } from '@/theme/ThemeProvider';

const LABELS: Record<PowerState, string> = {
  on: 'Світло є',
  warning: 'Скоро вимкнення',
  off: 'Відключення',
  allClear: 'Відключень немає',
  unknown: 'Немає даних',
};

const PILL_LABELS: Record<PowerState, string> = {
  on: 'За графіком',
  warning: 'Скоро вимкнення',
  off: 'Відключення',
  allClear: 'За графіком',
  unknown: 'Немає даних',
};

interface HeroStatusProps {
  state: PowerState;
  summary: ScheduleWindow | null;
  intervals: ScheduleIntervalUtc[];
  today: string;
  now: Date;
  isTomorrow?: boolean;
  queue: string | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Главный Hero-блок: стильная Obsidian карточка с 1px цветным стеклянным бордером,
 * радиальным свечением в тон состояния и крупным акцентным таймером.
 *
 * Форк за ADR-0007 (mobile): градиент и свечение — `expo-linear-gradient` +
 * `react-native-svg`, которых нет в DOM-версии. Логика состояния общая:
 * `state`, `summary`, `slotProgress` считает `@svitlo/core`, не этот файл.
 */
export function HeroStatus({
  state,
  summary,
  intervals,
  today,
  now,
  isTomorrow = false,
  queue,
  isLoading,
  isError,
}: HeroStatusProps) {
  const { palette } = useTheme();
  const tone = palette.status[state];
  const waveTone: WaveTone = waveToneOf(state);

  // Текст подписи выбирает компонент, но сам факт («график есть», «сегодня уже всё прошло»,
  // «графика нет») решает ядро. Прод-баг 5/1: в 15:27 при отключении 12:00–14:00 бейдж говорил
  // «За графіком», а подпись — «Графік ще не опубліковано». Разделяем «нет будущих» и «нет графика».
  const notice = heroNotice({
    loading: isLoading,
    error: isError,
    state,
    hasIntervals: intervals.length > 0,
    summary,
  });

  const tomorrowFirstOffTime =
    isTomorrow && summary?.nextStartsAt ? minutesToHm(minutesOfDay(summary.nextStartsAt, today)) : null;

  const headerNotice = (() => {
    switch (notice) {
      case 'loading':
        return isTomorrow ? 'Завантажуємо графік на завтра…' : 'Завантажуємо графік…';
      case 'error':
        return isTomorrow ? 'Графік на завтра недоступний' : 'Графік недоступний';
      case 'unpublished':
        return isTomorrow ? 'Графік на завтра ще не опубліковано' : 'Графік ще не опубліковано';
      case 'allClear':
        return isTomorrow ? 'Завтра відключень не заплановано' : 'Сьогодні відключень не заплановано';
      case 'off':
        return summary?.offEndsAt
          ? `Включення о ${minutesToHm(minutesOfDay(summary.offEndsAt, today))}`
          : isTomorrow
            ? 'Відключення за графіком'
            : 'Зараз відключення за графіком';
      case 'upcoming':
        return isTomorrow
          ? null
          : `Наступне відключення: ${minutesToHm(minutesOfDay(summary!.nextStartsAt!, today))}`;
      case 'finishedToday':
        return isTomorrow ? 'Завтра відключень більше не заплановано' : 'Більше відключень сьогодні не заплановано';
    }
  })();

  const progress = useMemo(
    () => (!isTomorrow && intervals.length > 0 ? slotProgress(intervals, today, now) : null),
    [intervals, today, now, isTomorrow],
  );

  const mainTimerValue = (() => {
    if (isTomorrow) return null;
    if (!summary) return null;
    if (state === 'off' && summary.backInMinutes != null) {
      return formatMinutesUk(summary.backInMinutes);
    }
    if ((state === 'warning' || state === 'on') && summary.nextInMinutes != null) {
      return formatMinutesUk(summary.nextInMinutes);
    }
    return null;
  })();

  const timerCaption = (() => {
    if (isTomorrow) return null;
    if (state === 'off') return 'До увімкнення';
    if (state === 'warning') return 'До відключення';
    if (state === 'on') return 'До відключення';
    return null;
  })();

  const bigStatusLabel = (() => {
    if (isTomorrow) {
      if (tomorrowFirstOffTime) return `Вимкнення о ${tomorrowFirstOffTime}`;
      if (notice === 'allClear') return 'Відключень немає';
      if (notice === 'unpublished') return 'Графік ще не опубліковано';
      if (notice === 'loading') return 'Завантаження…';
      if (notice === 'error') return 'Немає даних';
      return LABELS[state];
    }
    return LABELS[state];
  })();

  const pillLabel = isTomorrow
    ? notice === 'unpublished'
      ? 'Завтра: очікується'
      : 'Завтра: за графіком'
    : PILL_LABELS[state];

  // «Дышащая» мягкая пульсация свечения в тон текущего состояния
  const pulseOpacity = useSharedValue(0.65);
  useEffect(() => {
    if (state === 'on' || state === 'allClear') {
      pulseOpacity.value = withRepeat(
        withSequence(withTiming(1, { duration: 2400 }), withTiming(0.4, { duration: 2400 })),
        -1,
        true
      );
    } else if (state === 'warning') {
      pulseOpacity.value = withRepeat(
        withSequence(withTiming(1, { duration: 1100 }), withTiming(0.35, { duration: 1100 })),
        -1,
        true
      );
    } else {
      pulseOpacity.value = withTiming(0.5, { duration: 600 });
    }
  }, [state, pulseOpacity]);

  const animatedGlowStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderColor: tone.border,
        borderWidth: 1,
        shadowColor: tone.color,
        shadowOpacity: 0.15,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
      className="relative overflow-hidden rounded-3xl p-3"
    >
      {/* 1px градиентная линия сверху в цвет текущего статуса */}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', tone.color, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 24, right: 24, top: 0, height: 1.5, zIndex: 10 }}
      />

      {/* Мягкое живое радиальное свечение цвета статуса */}
      {/* Позицію задаємо інлайн-стилем: у web-збірці (Mini App) клас `absolute` на
          `Animated.View` губиться поруч з анімованим стилем, і свічення стає блоком
          280 px у потоці — картка розтягувалась на пів екрана. */}
      <Animated.View
        pointerEvents="none"
        renderToHardwareTextureAndroid={true}
        style={[{ position: 'absolute', right: -64, top: -80 }, animatedGlowStyle]}
      >
        <Svg width={280} height={280}>
          <Defs>
            <RadialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={tone.color} stopOpacity={0.16} />
              <Stop offset="1" stopColor={tone.color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={140} cy={140} r={140} fill="url(#hero-glow)" />
        </Svg>
      </Animated.View>

      {/* Верхний стеклянный блик */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 100 }}
      />

      {/* Шапка карточки: Статус пилл слева, Номер очереди справа */}
      <View className="flex-row items-center justify-between gap-2">
        <StatusPill state={state} label={pillLabel} pulse={!isTomorrow && state === 'on'} />
        <View className="rounded-xl bg-surface-container-highest px-3 py-1">
          <Text className="text-xs font-bold uppercase tracking-wider text-foreground">
            {queue ? `ЧЕРГА ${queue}` : 'Оберіть чергу'}
          </Text>
        </View>
      </View>

      {/* Плашка часу події */}
      {headerNotice ? (
        <View className="mt-4 self-start pb-1">
          <Text className="text-sm font-semibold tracking-wide" style={{ color: tone.text }}>
            {headerNotice}
          </Text>
          <View style={{ height: 2, backgroundColor: tone.color, width: '100%', borderRadius: 1, opacity: 0.8 }} />
        </View>
      ) : null}

      {/* Крупний акцентний таймер або статус */}
      {mainTimerValue ? (
        <View className="mt-2">
          <Text className="text-4xl font-extrabold tracking-tight tabular-nums" style={{ color: tone.text }}>
            {mainTimerValue}
          </Text>
          {timerCaption ? (
            <Text className="mt-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {timerCaption}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text
          className={headerNotice ? "mt-2 text-3xl font-extrabold tracking-tight" : "mt-4 text-3xl font-extrabold tracking-tight"}
          style={{ color: tone.text }}
        >
          {bigStatusLabel}
        </Text>
      )}

      {/* Волна прогресса текущего окна */}
      {progress && state !== 'unknown' ? (
        <View className="mt-4">
          <WavyProgressBar
            progress={progress.percent}
            tone={waveTone}
            elapsedLabel={`Пройшло ${formatMinutesUk(progress.elapsedMinutes)}`}
            remainingLabel={`Залишилось ${formatMinutesUk(progress.remainingMinutes)}`}
          />
        </View>
      ) : null}
    </View>
  );
}
