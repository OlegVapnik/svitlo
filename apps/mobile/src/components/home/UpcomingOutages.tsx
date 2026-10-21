import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { GroupOutageInterval, GroupOutageSummary } from '@svitlo/shared';

import { useTheme } from '@/theme/ThemeProvider';

interface UpcomingOutagesProps {
  outages: GroupOutageSummary[];
  today: string;
  tomorrow: string;
  /** Поточний момент із хвилинного тікера: за ним приглушуємо вже минулі вікна. */
  now: number;
}

interface OutageCard {
  key: string;
  date: string;
  queues: string[];
  intervals: GroupOutageInterval[];
  startsAt: number;
  endsAt: number;
}

/** «00:00» у кінці — це кінець доби, а не початок наступної: показуємо «24:00». */
function rangeLabel(interval: GroupOutageInterval): string {
  const to = interval.localTimeTo === '00:00' ? '24:00' : interval.localTimeTo;
  return `${interval.localTimeFrom}–${to}`;
}

function intervalsSignature(intervals: GroupOutageInterval[]): string {
  return intervals.map((interval) => `${interval.localTimeFrom}-${interval.localTimeTo}`).join(',');
}

/**
 * Ближайшие отключения по группам области — это ПЛАН, а не факт.
 *
 * Источник — `schedules/upcoming`: ГПВ-слоты оператора по группам. Показываем сегодня и завтра —
 * дальше график всё равно переписывают, а в списке будущих окон устаревшее легко принять за
 * актуальное.
 *
 * Групи з однаковими вікнами склеюються в одну картку: у Києві 60 груп, і шість однакових рядків
 * «16:00–20:00» з різними номерами виглядали як шість різних подій, хоча це одне вікно графіка.
 * Картка лишається легкою (тонка янтарна риска), бо це план; минулі вікна приглушені, щоб їх не
 * читали як «зараз».
 */
export function UpcomingOutages({ outages, today, tomorrow, now }: UpcomingOutagesProps) {
  const { palette } = useTheme();
  const planTone = palette.status.warning;

  const cards = useMemo(() => {
    const grouped = new Map<string, OutageCard>();
    for (const item of outages) {
      if (item.date !== today && item.date !== tomorrow) continue;
      const withOutages = item.intervals.filter((interval) => interval.stateCode === 3);
      if (withOutages.length === 0) continue;
      const key = `${item.date}|${intervalsSignature(withOutages)}`;
      const startsAt = Math.min(...withOutages.map((interval) => Date.parse(interval.startsAt)));
      const endsAt = Math.max(...withOutages.map((interval) => Date.parse(interval.endsAt)));
      const existing = grouped.get(key);
      if (existing) {
        existing.queues.push(item.queue);
        existing.startsAt = Math.min(existing.startsAt, startsAt);
        existing.endsAt = Math.max(existing.endsAt, endsAt);
      } else {
        grouped.set(key, {
          key,
          date: item.date,
          queues: [item.queue],
          intervals: withOutages,
          startsAt,
          endsAt,
        });
      }
    }
    return [...grouped.values()]
      .sort((a, b) => a.startsAt - b.startsAt)
      .slice(0, 12);
  }, [outages, today, tomorrow]);

  if (cards.length === 0) {
    return (
      <View className="gap-2">
        <Text className="text-sm font-semibold text-foreground">Найближчі відключення</Text>
        <Text className="text-sm text-muted-foreground">
          На сьогодні й завтра відключень за графіком немає.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-sm font-semibold text-foreground">Найближчі відключення</Text>
        <Text className="text-[11px] text-muted-foreground">за графіком ГПВ</Text>
      </View>
      {cards.map((card) => {
        const isPast = card.endsAt <= now;
        const isActive = card.startsAt <= now && card.endsAt > now;
        const queueLabel =
          card.queues.length > 6
            ? `${card.queues.slice(0, 6).join(', ')} +${card.queues.length - 6}`
            : card.queues.join(', ');
        return (
          <View
            key={card.key}
            style={{
              borderLeftWidth: 3,
              borderLeftColor: isActive ? palette.status.warning.color : planTone.color,
              opacity: isPast ? 0.45 : 1,
            }}
            className="flex-row items-center justify-between gap-3 rounded-2xl border border-border bg-surface-container-low py-3 pl-2 pr-4"
          >
            <View className="flex-1 gap-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {card.date === today ? 'Сьогодні' : 'Завтра'}
                </Text>
                {isActive ? (
                  <View
                    className="rounded-full px-2 py-0.5"
                    style={{ backgroundColor: palette.status.warning.soft }}
                  >
                    <Text className="text-[10px] font-semibold" style={{ color: palette.status.warning.text }}>
                      Триває
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-[11px] text-muted-foreground" numberOfLines={2}>
                {card.queues.length === 1 ? 'Черга' : 'Черги'} {queueLabel}
              </Text>
            </View>
            <Text className="text-sm font-medium text-foreground">
              {card.intervals.map(rangeLabel).join(', ')}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
