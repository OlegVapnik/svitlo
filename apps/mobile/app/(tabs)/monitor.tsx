import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useIncidents, useOutages, useQueues, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { formatDate, formatTimeRange } from '@svitlo/core/lib/date';
import { canonicalQueueCode } from '@svitlo/core/lib/queue';
import type { Incident, Outage } from '@svitlo/shared';

import { QueueTiles } from '@/components/monitor/QueueTiles';
import { ScreenHeader } from '@/components/navigation/ScreenHeader';
import { useRegion } from '@/context/RegionContext';
import { useMinuteTicker } from '@/hooks/useMinuteTicker';
import { useRegionQueue } from '@/hooks/useRegionQueue';
import { useTheme } from '@/theme/ThemeProvider';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';

const SEGMENTS = [
  { id: 'groups', label: 'Групи' },
  { id: 'outages', label: 'Відключення' },
  { id: 'incidents', label: 'Події' },
] as const;

type SegmentId = (typeof SEGMENTS)[number]['id'];

const OUTAGE_STATUS_LABEL: Record<Outage['status'], string> = {
  scheduled: 'Заплановано',
  active: 'Триває',
  finished: 'Завершено',
  cancelled: 'Скасовано',
};

/**
 * Монитор: группы области, отключения и события.
 *
 * На вебе этот раздел включал карту отключений. В мобильном карты нет сознательно: она требует
 * нативного движка (react-native-maps), ключей Google/Apple, правки манифеста и разрешений, а
 * отвечает не на главный вопрос. Человеку нужен код своей группы и время — это список и плитки,
 * которые работают офлайн и не расходуют батарею на фоновый рендер тайлов.
 */
export default function MonitorScreen() {
  const { currentRegion, currentRegionData } = useRegion();
  const { palette } = useTheme();
  const [segment, setSegment] = useState<SegmentId>('groups');
  const now = useMinuteTicker().getTime();

  const queuesQuery = useQueues(currentRegionData.cpu);
  const upcomingQuery = useUpcomingGroupOutages(currentRegion, 2);
  const outagesQuery = useOutages({ region: currentRegion, limit: 100 });
  const incidentsQuery = useIncidents();

  const apiQueues = queuesQuery.data?.data ?? [];
  // Если /queues пуст (область без импорта), состав берём из каталога — иначе экран молчал бы,
  // хотя область в справочнике есть. Пусто и там — честно покажем, что групп нет.
  const queues = apiQueues.length > 0 ? apiQueues : (currentRegionData.queues ?? []).map((queue) => ({ queue }));
  const upcoming = upcomingQuery.data?.data ?? [];
  const outages = useMemo(
    () =>
      [...(outagesQuery.data?.data ?? [])].sort((left, right) => {
        const rank = (item: Outage) => (item.status === 'active' ? 0 : item.status === 'scheduled' ? 1 : 2);
        // Внутри одного статуса авария весит больше плана: в списке «Відключення» человек ищет
        // прежде всего то, что сейчас без света не по графику.
        const kindRank = (item: Outage) => (item.kind === 'repair' ? 0 : 1);
        return (
          rank(left) - rank(right) ||
          kindRank(left) - kindRank(right) ||
          right.startsAt.localeCompare(left.startsAt)
        );
      }),
    [outagesQuery.data],
  );
  // Однаковые плановые окна у разных групп — одно событие графика, а не десяток карточек.
  // Для аварий (`repair`) склейки нет: у каждой свой адрес и причина.
  const outageGroups = useMemo(() => {
    const grouped = new Map<string, { key: string; items: Outage[]; startsAt: number; endsAt: number }>();
    for (const item of outages) {
      const key =
        item.kind === 'repair'
          ? `repair:${item.id}`
          : `plan:${item.startsAt}:${item.endsAt}:${item.status}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        grouped.set(key, {
          key,
          items: [item],
          startsAt: Date.parse(item.startsAt),
          endsAt: Date.parse(item.endsAt),
        });
      }
    }
    return [...grouped.values()];
  }, [outages]);

  // Дату показываем один раз над списком дня, а не в каждой карточке: иначе «21 жовт. 2026»
  // повторялся столько раз, сколько окон опубликовал оператор.
  const outageDays = useMemo(() => {
    const days = new Map<string, typeof outageGroups>();
    for (const group of outageGroups) {
      const day = formatDate(new Date(group.startsAt).toISOString());
      const bucket = days.get(day);
      if (bucket) bucket.push(group);
      else days.set(day, [group]);
    }
    return [...days.entries()];
  }, [outageGroups]);

  const incidents = useMemo(
    () => [...(incidentsQuery.data?.data ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 30),
    [incidentsQuery.data],
  );

  const availableQueues = currentRegionData.queues ?? queues.map((item) => item.queue);
  const { selectedQueue, selectQueue } = useRegionQueue(currentRegion, availableQueues);

  return (
    <SwipeableScreen>
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
      <ScrollView contentContainerStyle={{ gap: 16, paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12 }}>
        <ScreenHeader title="Монітор" subtitle="Що відбувається зі світлом в області." />

        <View className="flex-row rounded-full border border-border bg-card p-0.5">
          {SEGMENTS.map(({ id, label }) => {
            const active = segment === id;
            return (
              <Pressable
                key={id}
                onPress={() => setSegment(id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                className={
                  active
                    ? 'min-h-11 flex-1 items-center justify-center rounded-full bg-primary px-3 active:opacity-80'
                    : 'min-h-11 flex-1 items-center justify-center rounded-full px-3 active:opacity-70'
                }
              >
                <Text className={active ? 'text-sm font-semibold text-on-primary' : 'text-sm font-semibold text-muted-foreground'}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {segment === 'groups' ? (
          <View className="gap-3">
            {queuesQuery.isLoading && queues.length === 0 ? (
              <ActivityIndicator color={palette.mutedForeground} />
            ) : (
              <QueueTiles
                regionCpu={currentRegionData.cpu}
                queues={queues}
                outages={upcoming}
                selected={selectedQueue}
                onSelect={selectQueue}
              />
            )}
            <Text className="text-xs text-muted-foreground">
              Точка під кодом показує, чи є світло за графіком зараз. Натисніть групу, щоб зробити її основною.
            </Text>
          </View>
        ) : null}

        {segment === 'outages' ? (
          <View className="gap-2">
            {outagesQuery.isLoading && outages.length === 0 ? (
              <ActivityIndicator color={palette.mutedForeground} />
            ) : outagesQuery.isError && outages.length === 0 ? (
              <Text className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Не вдалося завантажити відключення. Перевірте звʼязок і спробуйте пізніше.
              </Text>
            ) : outages.length === 0 ? (
              <Text className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Відключень за графіком немає.
              </Text>
            ) : (
              outageDays.map(([day, groups]) => (
                <View key={day} className="gap-2">
                  <Text className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {day}
                  </Text>
                  {groups.map((group) => (
                    <OutageCard key={group.key} group={group} regionCpu={currentRegionData.cpu} now={now} />
                  ))}
                </View>
              ))
            )}
          </View>
        ) : null}

        {segment === 'incidents' ? (
          <View className="gap-2">
            {incidentsQuery.isLoading && incidents.length === 0 ? (
              <ActivityIndicator color={palette.mutedForeground} />
            ) : incidentsQuery.isError && incidents.length === 0 ? (
              <Text className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Не вдалося завантажити події. Перевірте звʼязок і спробуйте пізніше.
              </Text>
            ) : incidents.length === 0 ? (
              <Text className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Нових подій немає.
              </Text>
            ) : (
              incidents.map((item) => <IncidentCard key={item.id} incident={item} />)
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
    </SwipeableScreen>
  );
}

function rangeLabel(startsAt: string, endsAt: string): string {
  // 00:00 в конце окна — это конец суток, а не начало следующего дня.
  return formatTimeRange(startsAt, endsAt).replace(/–00:00$/, '–24:00');
}

function OutageCard({
  group,
  regionCpu,
  now,
}: {
  group: { items: Outage[]; startsAt: number; endsAt: number };
  regionCpu: string;
  now: number;
}) {
  const { palette } = useTheme();
  const first = group.items[0];
  const isAccident = first.kind === 'repair';
  const isPast = group.endsAt <= now || first.status === 'finished' || first.status === 'cancelled';
  const isActive = !isPast && group.startsAt <= now && group.endsAt > now;
  const tone = isAccident
    ? palette.status.off
    : first.status === 'active'
      ? palette.status.off
      : first.status === 'scheduled'
        ? palette.status.warning
        : palette.status.unknown;
  const queues = [
    ...new Set(
      group.items.map(
        (item) => item.group ?? (item.queue != null ? canonicalQueueCode(regionCpu, String(item.queue)) : null),
      ),
    ),
  ].filter((queue): queue is string => Boolean(queue));
  const queueLabel =
    queues.length > 8 ? `${queues.slice(0, 8).join(', ')} +${queues.length - 8}` : queues.join(', ');
  const areas = [...new Set(group.items.map((item) => item.areaName).filter(Boolean))];
  const details = [...new Set(group.items.map((item) => item.reason || item.addressesNormalized || item.addressesRaw).filter(Boolean))];
  const progress = isActive
    ? Math.min(1, Math.max(0, (now - group.startsAt) / Math.max(1, group.endsAt - group.startsAt)))
    : 0;

  return (
    <View
      style={{
        borderWidth: isAccident ? 2 : 1,
        borderColor: isAccident ? tone.border : palette.border,
        backgroundColor: isAccident ? tone.soft : palette.surfaceContainerLow,
        opacity: isPast ? 0.45 : 1,
      }}
      className="gap-2 rounded-2xl px-4 py-3"
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-sm font-semibold text-foreground">
          {rangeLabel(first.startsAt, first.endsAt)}
        </Text>
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: tone.soft, borderColor: tone.border, borderWidth: 1 }}>
          <Text className="text-[10px] font-semibold" style={{ color: tone.text }}>
            {isActive ? 'Триває' : OUTAGE_STATUS_LABEL[first.status]}
          </Text>
        </View>
      </View>

      {isActive ? (
        <View className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: tone.border }}>
          <View className="h-full rounded-full" style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: tone.color }} />
        </View>
      ) : null}

      <View className="flex-row items-center gap-2">
        {queueLabel ? (
          <View className="flex-1 rounded-lg bg-surface-container-highest px-2 py-0.5">
            <Text className="text-xs font-bold text-foreground" numberOfLines={2}>
              {queues.length === 1 ? 'Черга' : 'Черги'} {queueLabel}
            </Text>
          </View>
        ) : null}
        <View
          className="rounded-full border px-2 py-0.5"
          style={{ borderColor: isAccident ? tone.border : palette.border, backgroundColor: palette.card }}
        >
          <Text
            className={isAccident ? 'text-[10px] font-bold' : 'text-[10px] font-medium text-muted-foreground'}
            style={isAccident ? { color: tone.text } : undefined}
          >
            {isAccident ? 'Аварія' : 'За графіком'}
          </Text>
        </View>
      </View>

      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {areas.length > 0 ? areas.join(', ') : 'Без району'}
      </Text>
      <Text className="text-xs text-muted-foreground" numberOfLines={3}>
        {isAccident
          ? details.join(' · ') || 'Причину не вказано.'
          : group.items.length > 1
            ? `Планове вікно за графіком ГПВ для ${group.items.length} груп.`
            : 'Планове вікно за графіком ГПВ.'}
      </Text>
    </View>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  const { palette } = useTheme();
  const tone =
    incident.severity === 'critical' || incident.severity === 'high'
      ? palette.status.off
      : incident.severity === 'medium'
        ? palette.status.warning
        : palette.status.unknown;

  return (
    <View className="gap-2 rounded-2xl border border-border bg-surface-container-low px-4 py-3">
      <View className="flex-row items-start gap-2">
        <View className="mt-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: tone.color }} />
        <View className="flex-1 gap-1">
          <Text className="text-sm font-semibold text-foreground">{incident.title}</Text>
          <Text className="text-xs text-muted-foreground">
            {formatDate(incident.startedAt)} · {incident.areaName || 'Область'}
          </Text>
        </View>
      </View>
      {incident.description ? (
        <Text className="text-xs leading-relaxed text-muted-foreground" numberOfLines={4}>
          {incident.description}
        </Text>
      ) : null}
      {incident.sourceUrl ? (
        <Pressable
          onPress={() => void Linking.openURL(incident.sourceUrl as string)}
          accessibilityRole="link"
          className="flex-row items-center gap-1 self-start py-1 active:opacity-70"
        >
          <Text className="text-xs font-semibold text-primary">Джерело</Text>
          <Ionicons name="open-outline" size={13} color={palette.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}
