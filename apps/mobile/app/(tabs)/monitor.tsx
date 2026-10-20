import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useIncidents, useOutages, useQueues, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { formatDate, formatTimeRange } from '@svitlo/core/lib/date';
import { canonicalQueueCode } from '@svitlo/core/lib/queue';
import type { Incident, Outage } from '@svitlo/shared';

import { RegionPicker } from '@/components/home/RegionPicker';
import { QueueTiles } from '@/components/monitor/QueueTiles';
import { useRegion } from '@/context/RegionContext';
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
        return rank(left) - rank(right) || right.startsAt.localeCompare(left.startsAt);
      }),
    [outagesQuery.data],
  );
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
        <View className="flex-row items-center justify-between">
          <View className="flex-1 gap-1 pr-3">
            <Text className="text-2xl font-bold tracking-tight text-foreground">Монітор</Text>
            <Text className="text-xs text-muted-foreground">Що відбувається зі світлом в області.</Text>
          </View>
          <RegionPicker />
        </View>

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
              outages.map((item) => <OutageCard key={item.id} outage={item} regionCpu={currentRegionData.cpu} />)
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

function OutageCard({ outage, regionCpu }: { outage: Outage; regionCpu: string }) {
  const { palette } = useTheme();
  const tone =
    outage.status === 'active'
      ? palette.status.off
      : outage.status === 'scheduled'
        ? palette.status.warning
        : palette.status.unknown;
  const group = outage.group ?? (outage.queue != null ? canonicalQueueCode(regionCpu, String(outage.queue)) : null);

  return (
    <View className="gap-2 rounded-2xl border border-border bg-surface-container-low px-4 py-3">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-sm font-semibold text-foreground">
          {formatDate(outage.startsAt)} · {formatTimeRange(outage.startsAt, outage.endsAt)}
        </Text>
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: tone.soft, borderColor: tone.border, borderWidth: 1 }}>
          <Text className="text-[10px] font-semibold" style={{ color: tone.text }}>
            {OUTAGE_STATUS_LABEL[outage.status]}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center gap-2">
        {group ? (
          <View className="rounded-lg bg-surface-container-highest px-2 py-0.5">
            <Text className="text-xs font-bold text-foreground">Черга {group}</Text>
          </View>
        ) : null}
        <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
          {outage.areaName || 'Без району'}
        </Text>
      </View>
      <Text className="text-xs text-muted-foreground" numberOfLines={3}>
        {outage.kind === 'group'
          ? 'Планове відключення за графіком ГПВ.'
          : outage.addressesNormalized || outage.addressesRaw || 'Адреси не вказані.'}
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
