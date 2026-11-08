import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { CheckCheck, Zap } from 'lucide-react-native';

import type { ScheduleChangeNotice } from '@svitlo/core/lib/schedule-change';

import { scheduleChangeView } from '@/lib/schedule-change-view';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Компактний чип «Що змінилось» на головній.
 *
 * Показуємо лише реальну зміну: постійний банер «графік без змін» з'їдав би перший екран.
 * Після першої правки чип живе до кінця доби — повторний рефреш не стирає історію, а
 * натискання розкриває всі ревізії з конкретними годинами.
 */
export function ScheduleChangeChip({ notice }: { notice: ScheduleChangeNotice | null }) {
  const { palette } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const view = scheduleChangeView(notice);
  if (!view) return null;

  const revisions = notice?.revisions ?? [];
  const TrendIcon = view.trend === 'more' ? Zap : CheckCheck;
  const trendColor = view.trend === 'more' ? palette.warning : palette.success;

  return (
    <View
      testID="schedule-change"
      style={{ backgroundColor: palette.surfaceContainerHigh, borderColor: palette.hairline, borderWidth: 1 }}
      className="gap-1.5 rounded-2xl px-3 py-2.5"
    >
      <View className="flex-row items-start gap-2">
        <TrendIcon size={14} color={trendColor} style={{ marginTop: 2 }} />
        <Text className="flex-1 text-xs leading-4">
          <Text style={{ color: palette.foreground }} className="font-semibold">
            {view.title}:{' '}
          </Text>
          {view.timeLabel ? (
            <Text style={{ color: palette.foreground }}>О {view.timeLabel} </Text>
          ) : null}
          <Text style={{ color: palette.mutedForeground }}>{view.summary}</Text>
        </Text>
      </View>

      {revisions.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Історія змін: ${revisions.length}`}
          onPress={() => setExpanded((value) => !value)}
          className="self-start"
        >
          <Text style={{ color: palette.mutedForeground }} className="text-[11px] font-medium">
            Історія змін ({revisions.length}) {expanded ? '▴' : '▾'}
          </Text>
        </Pressable>
      ) : null}

      {expanded ? (
        <View style={{ borderColor: palette.hairline }} className="gap-1 border-t pt-1.5">
          {revisions.map((revision, index) => (
            <Text
              key={`${revision.detectedAt}-${index}`}
              style={{ color: palette.mutedForeground }}
              className="text-[11px] leading-4"
            >
              {revision.detectedAtLabel || '—'} · {revision.summaryUk}
            </Text>
          ))}
          {notice?.planAccuracyPercent !== null && notice?.planAccuracyPercent !== undefined ? (
            <Text style={{ color: palette.mutedForeground }} className="text-[11px]">
              План vs факт: {notice.planAccuracyPercent}%
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
