import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import {
  formatMinutesUk,
  minutesOfDay,
  minutesToHm,
  slotProgress,
  type ScheduleWindow,
} from '@svitlo/core/lib/scheduleWindow';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import { StatusPill } from '@/components/ui/StatusPill';
import { WavyProgressBar, type WaveTone } from '@/components/ui/WavyProgressBar';
import { useTheme, type PowerState } from '@/theme/ThemeProvider';

const LABELS: Record<PowerState, string> = {
  on: 'Світло є',
  warning: 'Скоро вимкнуть',
  off: 'Світла немає',
  allClear: 'Відключень немає',
  unknown: 'Немає даних',
};

const PILL_LABELS: Record<PowerState, string> = {
  on: 'За графіком',
  warning: 'Скоро відключення',
  off: 'За графіком',
  allClear: 'Перевірено',
  unknown: 'Немає даних',
};

interface HeroStatusProps {
  state: PowerState;
  summary: ScheduleWindow | null;
  intervals: ScheduleIntervalUtc[];
  date: string;
  now: Date;
  queue: string | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Главный статус: Obsidian-карточка с мягким радиальным свечением состояния.
 *
 * Свечение — SVG RadialGradient на 10% прозрачности, верхний блик — LinearGradient.
 * Цифры и волна окрашены тем же `palette.status[state]`: при отсутствии данных —
 * строго графит, зелёный «на всякий случай» запрещён.
 */
export function HeroStatus({
  state,
  summary,
  intervals,
  date,
  now,
  queue,
  isLoading,
  isError,
}: HeroStatusProps) {
  const { palette } = useTheme();
  const tone = palette.status[state];
  const waveTone: WaveTone = state === 'allClear' ? 'on' : state === 'unknown' ? 'unknown' : state;

  const detail = (() => {
    if (isLoading) return 'Завантажуємо графік…';
    if (isError) return 'Графік недоступний — показано останні дані';
    if (state === 'allClear') return 'Відключень за графіком на сьогодні немає';
    if (!summary) return 'Оператор не опублікував графік на сьогодні';
    if (state === 'off' && summary.offEndsAt) {
      return `До ${minutesToHm(minutesOfDay(summary.offEndsAt, date))}`;
    }
    if (state === 'off' && summary.backInMinutes != null) {
      return `Світло повернуть через ${formatMinutesUk(summary.backInMinutes)}`;
    }
    if (state === 'warning' && summary.nextInMinutes != null) {
      return `Вимкнуть через ${formatMinutesUk(summary.nextInMinutes)}`;
    }
    if (state === 'on' && summary.nextStartsAt) {
      return `Наступне відключення: ${minutesToHm(minutesOfDay(summary.nextStartsAt, date))}`;
    }
    return 'Відключень за графіком на сьогодні немає';
  })();

  const progress = useMemo(
    () => (intervals.length > 0 ? slotProgress(intervals, date, now) : null),
    [intervals, date, now],
  );

  const timer = (() => {
    if (!summary) return null;
    if (state === 'off' && summary.backInMinutes != null) {
      return { prefix: 'До включення', value: formatMinutesUk(summary.backInMinutes) };
    }
    if (state === 'warning' && summary.nextInMinutes != null) {
      return { prefix: 'До відключення', value: formatMinutesUk(summary.nextInMinutes) };
    }
    if (state === 'on' && summary.nextInMinutes != null) {
      return { prefix: 'До відключення', value: formatMinutesUk(summary.nextInMinutes) };
    }
    return null;
  })();

  return (
    <View
      style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
      className="relative overflow-hidden rounded-3xl border p-5"
    >
      {/* Мягкое радиальное свечение тона состояния — только 10% прозрачности. */}
      <View pointerEvents="none" className="absolute -right-16 -top-20">
        <Svg width={280} height={280}>
          <Defs>
            <RadialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={tone.color} stopOpacity={0.1} />
              <Stop offset="1" stopColor={tone.color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={140} cy={140} r={140} fill="url(#hero-glow)" />
        </Svg>
      </View>

      {/* Верхний блик карточки. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 96 }}
      />

      <View className="flex-row items-center justify-between gap-2">
        <StatusPill state={state} label={PILL_LABELS[state]} pulse={state === 'on'} />
        <View className="flex-row items-center gap-1.5">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {queue ? `Черга ${queue}` : 'Черга не вибрана'}
          </Text>
        </View>
      </View>

      <Text className="mt-4 text-[34px] font-bold leading-tight tracking-tight" style={{ color: tone.text }}>
        {LABELS[state]}
      </Text>

      <Text className="mt-1 text-sm" style={{ color: palette.mutedForeground }}>
        {detail}
      </Text>

      {timer ? (
        <View className="mt-4 flex-row items-baseline gap-2">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {timer.prefix}
          </Text>
          <Text className="text-2xl font-bold tabular-nums" style={{ color: tone.text }}>
            {timer.value}
          </Text>
        </View>
      ) : null}

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

      {summary && summary.offMinutes > 0 ? (
        <Text className="mt-3 text-xs text-muted-foreground">
          Без світла за графіком за добу: {formatMinutesUk(summary.offMinutes)}
        </Text>
      ) : null}
    </View>
  );
}
