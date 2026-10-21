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
  warning: 'Скоро вимкнення',
  off: 'Відключення',
  allClear: 'Відключень немає',
  unknown: 'Немає даних',
};

const PILL_LABELS: Record<PowerState, string> = {
  on: '⚡ За графіком',
  warning: '⚠️ Скоро вимкнення',
  off: 'Відключення',
  allClear: '⚡ За графіком',
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
 * Главный Hero-блок: стильная Obsidian карточка с 1px цветным стеклянным бордером,
 * радиальным свечением в тон состояния и крупным акцентным таймером.
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

  const headerNotice = (() => {
    if (isLoading) return 'Завантажуємо графік…';
    if (isError) return 'Графік недоступний';
    if (state === 'allClear') return 'Сьогодні відключень не заплановано';
    if (!summary) return 'Графік ще не опубліковано';
    if (state === 'off' && summary.offEndsAt) {
      return `Включення о ${minutesToHm(minutesOfDay(summary.offEndsAt, date))}`;
    }
    if (state === 'warning' && summary.nextStartsAt) {
      return `Наступне відключення: ${minutesToHm(minutesOfDay(summary.nextStartsAt, date))}`;
    }
    if (state === 'on' && summary.nextStartsAt) {
      return `Наступне відключення: ${minutesToHm(minutesOfDay(summary.nextStartsAt, date))}`;
    }
    return 'Графік ще не опубліковано';
  })();

  const progress = useMemo(
    () => (intervals.length > 0 ? slotProgress(intervals, date, now) : null),
    [intervals, date, now],
  );

  const mainTimerValue = (() => {
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
    if (state === 'off') return 'До увімкнення';
    if (state === 'warning') return 'До відключення';
    if (state === 'on') return 'До відключення';
    return null;
  })();

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
      className="relative overflow-hidden rounded-3xl p-5"
    >
      {/* 1px градиентная линия сверху в цвет текущего статуса */}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', tone.color, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 24, right: 24, top: 0, height: 1.5, zIndex: 10 }}
      />

      {/* Мягкое радиальное свечение цвета статуса */}
      <View pointerEvents="none" className="absolute -right-16 -top-20">
        <Svg width={280} height={280}>
          <Defs>
            <RadialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={tone.color} stopOpacity={0.16} />
              <Stop offset="1" stopColor={tone.color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={140} cy={140} r={140} fill="url(#hero-glow)" />
        </Svg>
      </View>

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
        <StatusPill state={state} label={PILL_LABELS[state]} pulse={state === 'on'} />
        <View className="rounded-xl bg-surface-container-highest px-3 py-1">
          <Text className="text-xs font-bold uppercase tracking-wider text-foreground">
            {queue ? `ЧЕРГА ${queue}` : 'Оберіть чергу'}
          </Text>
        </View>
      </View>

      {/* Плашка времени события с подчеркиванием */}
      <View className="mt-4 self-start pb-1">
        <Text className="text-sm font-semibold tracking-wide" style={{ color: tone.text }}>
          {headerNotice}
        </Text>
        <View style={{ height: 2, backgroundColor: tone.color, width: '100%', borderRadius: 1, opacity: 0.8 }} />
      </View>

      {/* Крупный акцентный таймер */}
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
        <Text className="mt-2 text-3xl font-extrabold tracking-tight" style={{ color: tone.text }}>
          {LABELS[state]}
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

      {summary && summary.offMinutes > 0 ? (
        <Text className="mt-3 text-xs text-muted-foreground">
          Без світла за графіком за добу: {formatMinutesUk(summary.offMinutes)}
        </Text>
      ) : null}
    </View>
  );
}
