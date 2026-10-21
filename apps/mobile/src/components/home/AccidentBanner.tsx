import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { formatTimeRange } from '@svitlo/core/lib/date';
import type { Outage } from '@svitlo/shared';

import { useTheme } from '@/theme/ThemeProvider';

interface AccidentBannerProps {
  outages: Outage[];
  loading?: boolean;
}

/**
 * Аварії окремо від графіка.
 *
 * ГПВ — це план: «за графіком о 14:00–16:00 світло вимкнуть». Аварія — факт, який плану не
 * підкоряється: мережу пошкодило, і світла немає поза вікнами. Раніше обидві сутності лежали в
 * одному списку з однаковою вагою, і людина читала «За графіком» на картці аварії.
 *
 * Тут важка карточка (2 px рамка, червона підложка, жирний заголовок) — тільки для аварій;
 * планові вікна лишаються легкими в «Найближчих відключеннях». Немає активних аварій — немає й
 * блока: порожня рамка «усе добре» виглядала б як вигадане підтвердження.
 */
export function AccidentBanner({ outages, loading }: AccidentBannerProps) {
  const { palette } = useTheme();
  const tone = palette.status.off;
  const accidents = outages.filter((item) => item.kind === 'repair' && item.status === 'active');

  if (accidents.length === 0) return null;

  return (
    <View
      className="gap-2 rounded-3xl border-2 px-4 py-3"
      style={{ borderColor: tone.border, backgroundColor: tone.soft }}
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name="warning" size={16} color={tone.color} />
        <Text className="flex-1 text-sm font-bold" style={{ color: tone.text }}>
          Аварійні відключення
        </Text>
        <View
          className="rounded-full border px-2 py-0.5"
          style={{ borderColor: tone.border, backgroundColor: palette.card }}
        >
          <Text className="text-[11px] font-bold" style={{ color: tone.text }}>
            {accidents.length}
          </Text>
        </View>
      </View>

      {accidents.slice(0, 2).map((item) => (
        <View key={item.id} className="gap-0.5">
          <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
            {item.areaName || 'Область'} · {formatTimeRange(item.startsAt, item.endsAt)}
          </Text>
          {item.reason ? (
            <Text className="text-[11px] leading-tight text-muted-foreground" numberOfLines={2}>
              {item.reason}
            </Text>
          ) : null}
        </View>
      ))}

      {accidents.length > 2 ? (
        <Text className="text-[11px] text-muted-foreground">Ще {accidents.length - 2} в «Моніторі».</Text>
      ) : null}

      <Text className="text-[11px] leading-tight text-muted-foreground">
        {loading ? 'Оновлюємо дані оператора…' : 'Це фактичні перерви, а не вікна графіка ГПВ.'}
      </Text>
    </View>
  );
}
