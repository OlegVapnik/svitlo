import { Link2, ShieldAlert, TriangleAlert, Wrench } from 'lucide-react-native';
import { Linking, Pressable, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { visibleGridRegime } from '@svitlo/core';
import type { GridRegimeSnapshot } from '@svitlo/shared';

import { useTheme } from '@/theme/ThemeProvider';
import { gridRegimeBannerView, type GridRegimeTone } from '@/lib/grid-regime-view';

interface GridRegimeBannerProps {
  regime: GridRegimeSnapshot | null;
  /** Поточна черга користувача: ГАВ/СГАВ показуємо лише для неї. */
  queue?: string | null;
}

const ICONS = {
  critical: ShieldAlert,
  alert: TriangleAlert,
  neutral: Wrench,
  info: Wrench,
} as const;

/**
 * Банер режиму мережі над карткою статусу.
 *
 * Раніше режим жив тільки в тексті новин: людина бачила «ГАВ» у стрічці й не розуміла, чи
 * стосується це її черги. Тут — одне речення про те, що відбувається, і посилання на джерело.
 * Тон і текст рахує чиста `grid-regime-view`, тому логіку видно в тестах без рендера.
 */
export function GridRegimeBanner({ regime, queue = null }: GridRegimeBannerProps) {
  const { palette } = useTheme();
  const visible = visibleGridRegime(regime, queue);
  if (!visible) return null;

  const view = gridRegimeBannerView(visible);
  const tone = toneOf(view.tone, palette);
  const Icon = ICONS[view.tone];

  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-start gap-3 rounded-3xl border p-4"
      style={{ borderColor: tone.border, backgroundColor: tone.soft }}
    >
      <Icon size={20} color={tone.color} style={{ marginTop: 2 }} />
      <View className="flex-1 gap-1">
        <Text className="text-sm font-bold leading-snug" style={{ color: tone.text }}>
          {view.title}
        </Text>
        <Text className="text-xs leading-relaxed text-muted-foreground">{view.body}</Text>
        {view.queues.length > 0 ? (
          <Text className="text-xs font-semibold text-foreground">
            Черги: {view.queues.join(', ')}
          </Text>
        ) : null}
        {visible.sourcePostUrl ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(visible.sourcePostUrl!)}
            className="mt-1 flex-row items-center gap-1 active:opacity-70"
          >
            <Link2 size={12} color={palette.primary} />
            <Text className="text-xs font-semibold" style={{ color: palette.primary }}>
              Джерело повідомлення
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function toneOf(tone: GridRegimeTone, palette: ReturnType<typeof useTheme>['palette']) {
  switch (tone) {
    case 'critical':
      return { color: palette.destructive, soft: 'rgba(244, 63, 94, 0.12)', border: 'rgba(244, 63, 94, 0.4)', text: palette.destructive };
    case 'alert':
      return { color: palette.warning, soft: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.4)', text: palette.warning };
    case 'info':
      return { color: palette.info, soft: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.35)', text: palette.foreground };
    default:
      return { color: palette.mutedForeground, soft: palette.surfaceContainerHigh, border: palette.border, text: palette.foreground };
  }
}
