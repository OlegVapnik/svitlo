import { Pressable, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text } from '@/components/ui/AppText';
import { useRegion } from '@/context/RegionContext';
import { triggerSelectionHaptic } from '@/lib/haptics';
import type { RegionSummary } from '@svitlo/core/lib/region';

/**
 * Выбор сети внутри одной области (Днепропетровщина: ДТЭК / ЦЕК).
 *
 * Каталог отдаёт сети отдельными записями с `parentCpu`, потому что графики у них разные и
 * смешивать их в один нельзя. Список областей показывает только саму область, а выбор сети
 * живёт здесь — чипсами под шапкой. Первый чип возвращает область целиком (её сеть по
 * умолчанию выбирает бэкенд, `preferredNetworkFor`).
 *
 * Форк за ADR-0007 (mobile): нативный `ScrollView` + `Pressable`, а не DOM-tabs.
 */
export function OperatorChips() {
  const { currentRegion, currentRegionData, regions, setRegion } = useRegion();

  const networks = networksOf(regions, currentRegionData);
  // Технічні аліаси (`dnipro-dnem`) не показуємо: у Дніпрі має бути чистий вибір ОСР.
  if (networks.length < 1) return null;

  const parent = regions.find((region) => region.cpu === (currentRegionData.parentCpu ?? currentRegionData.cpu));
  const parentCpu = parent?.cpu ?? currentRegionData.cpu;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      accessibilityRole="tablist"
    >
      <Chip
        label={parentLabel(parentCpu)}
        active={currentRegion === parentCpu}
        onPress={() => setRegion(parentCpu)}
      />
      {networks.map((network) => (
        <Chip
          key={network.cpu}
          label={networkLabel(network)}
          active={currentRegion === network.cpu}
          onPress={() => setRegion(network.cpu)}
        />
      ))}
    </ScrollView>
  );
}

/**
 * Технические алиасы, которые не являются отдельным оператором.
 *
 * `dnipro-dnem` — это ДТЭК Днепровские электросети; его данные совпадают с канонической
 * `dnipropetrovska-oblast`. Два чипса с одинаковым графиком только путают человека.
 */
const ALIAS_NETWORKS = new Set(['dnipro-dnem']);

/** Подпись «главного» чипса: для Днепра, Николаева и Киева это оператор сети по умолчанию. */
const PARENT_LABELS: Record<string, string> = {
  'dnipropetrovska-oblast': 'ДТЕК',
  'mykolaivska-oblast': 'МОЕ',
  'kyivska-oblast': 'ДТЕК КРЕМ',
};

export function parentLabel(parentCpu: string): string {
  return PARENT_LABELS[parentCpu] ?? 'Уся область';
}

/** Сети выбранной области: записи каталога с `parentCpu`, указывающим на её родителя. */
export function networksOf(regions: RegionSummary[], current: RegionSummary): RegionSummary[] {
  const parentCpu = current.parentCpu ?? current.cpu;
  return regions.filter(
    (region) => region.parentCpu === parentCpu && !ALIAS_NETWORKS.has(region.cpu),
  );
}

/**
 * Короткая подпись сети: «м. Дніпро (ЦЕК)» → «ЦЕК», «atom» → «Атомсервіс».
 *
 * В скобках оператор, в префиксе — город; чипсу город не нужен, он и так под шапкой области.
 */
export function networkLabel(region: RegionSummary): string {
  if (region.cpu === 'atom') return 'Атомсервіс';
  if (region.cpu === 'slavutych') return 'Славутич (ЧОЕ)';
  const inside = /\(([^)]+)\)/u.exec(region.nameUa ?? '');
  if (inside?.[1]) return inside[1].trim();
  const short = (region.nameUa ?? region.cpu).replace(/^м\.\s*/u, '').trim();
  return short || region.cpu;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={() => {
        triggerSelectionHaptic();
        onPress();
      }}
      className={
        active
          ? 'flex-row items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 active:opacity-80'
          : 'flex-row items-center gap-1.5 rounded-full border border-border bg-surface-container-high px-3.5 py-1.5 active:opacity-70'
      }
    >
      {active ? <Ionicons name="checkmark" size={13} color="#ffffff" /> : null}
      <Text className={active ? 'text-xs font-semibold text-on-primary' : 'text-xs font-medium text-on-surface'}>
        {label}
      </Text>
    </Pressable>
  );
}
