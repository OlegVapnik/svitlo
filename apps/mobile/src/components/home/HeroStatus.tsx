import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { formatMinutesUk, minutesOfDay, minutesToHm, type ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';

import { useTheme, type PowerState } from '@/theme/ThemeProvider';

const LABELS: Record<PowerState, string> = {
  on: 'Світло є',
  warning: 'Скоро вимкнуть',
  off: 'Світла немає',
  unknown: 'Немає даних',
};

const ICONS: Record<PowerState, keyof typeof Ionicons.glyphMap> = {
  on: 'sunny-outline',
  warning: 'alert-circle-outline',
  off: 'moon-outline',
  unknown: 'help-circle-outline',
};

interface HeroStatusProps {
  state: PowerState;
  summary: ScheduleWindow | null;
  queue: string | null;
  today: string;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Главный статус: светло или нет, и что будет дальше.
 *
 * Тон берём из `palette.status[state]` (JS-объект), а не из className: цвет зависит от данных,
 * а инжектор NativeWind компилирует классы статически. Формулировки и пороги — как в веб-версии.
 */
export function HeroStatus({ state, summary, queue, today, isLoading, isError }: HeroStatusProps) {
  const { palette } = useTheme();
  const tone = palette.status[state];

  const detail = (() => {
    if (isLoading) return 'Завантажуємо графік…';
    if (isError) return 'Графік недоступний — показано останні дані';
    if (!summary) return 'Оператор не опублікував графік на сьогодні';
    if (state === 'off' && summary.offEndsAt) {
      return `До ${minutesToHm(minutesOfDay(summary.offEndsAt, today))}`;
    }
    if (state === 'off' && summary.backInMinutes != null) {
      return `Світло повернуть через ${formatMinutesUk(summary.backInMinutes)}`;
    }
    if (state === 'warning' && summary.nextInMinutes != null) {
      return `Вимкнуть через ${formatMinutesUk(summary.nextInMinutes)}`;
    }
    if (state === 'on' && summary.nextStartsAt) {
      return `Наступне відключення: ${minutesToHm(minutesOfDay(summary.nextStartsAt, today))}`;
    }
    return 'Відключень за графіком на сьогодні немає';
  })();

  return (
    <View
      className="rounded-3xl border p-5"
      style={{ backgroundColor: tone.soft, borderColor: tone.border }}
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name={ICONS[state]} size={18} color={tone.color} />
        <Text className="text-sm font-medium" style={{ color: tone.text }}>
          {queue ? `Черга ${queue}` : 'Черга не вибрана'}
        </Text>
      </View>

      <Text className="mt-2 text-3xl font-bold" style={{ color: tone.text }}>
        {LABELS[state]}
      </Text>

      <Text className="mt-1 text-sm" style={{ color: tone.text }}>
        {detail}
      </Text>

      {summary && summary.offMinutes > 0 ? (
        <Text className="mt-3 text-xs text-muted-foreground">
          Без світла за графіком за добу: {formatMinutesUk(summary.offMinutes)}
        </Text>
      ) : null}
    </View>
  );
}
