import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '@/components/ui/AppText';
import { useTheme } from '@/theme/ThemeProvider';
import type { RegionSummary } from '@svitlo/core/lib/region';

interface DataTransparencyBarProps {
  region: RegionSummary;
}

function formatKyivDateTime(isoStr?: string | null): string {
  if (!isoStr) return 'нещодавно';
  try {
    const date = new Date(isoStr);
    if (Number.isNaN(date.getTime())) return 'нещодавно';
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const time = date.toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Kyiv',
    });

    if (isToday) {
      return `сьогодні о ${time}`;
    }
    const dayMonth = date.toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Kyiv',
    });
    return `${dayMonth} о ${time}`;
  } catch {
    return 'нещодавно';
  }
}

function timeAgo(isoStr?: string | null): string {
  if (!isoStr) return '';
  try {
    const diffMs = Date.now() - new Date(isoStr).getTime();
    if (diffMs < 0 || Number.isNaN(diffMs)) return '';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec} с тому`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} хв тому`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} год тому`;
    return `${Math.floor(diffHours / 24)} дн тому`;
  } catch {
    return '';
  }
}

export function DataTransparencyBar({ region }: DataTransparencyBarProps) {
  const { palette } = useTheme();

  const sourceName = region.sourceLabel || 'Офіційний оператор розподілу';
  const updatedText = formatKyivDateTime(region.updatedAt);
  const checkAgo = timeAgo(region.lastCheckAt);

  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderColor: palette.hairline,
        borderWidth: 1,
      }}
      className="flex-col gap-1.5 rounded-2xl p-3 shadow-xs"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5 shrink">
          <Ionicons name="shield-checkmark-outline" size={14} color={palette.primary} />
          <Text className="text-xs font-semibold text-foreground shrink" numberOfLines={1}>
            {sourceName}
          </Text>
        </View>

        {checkAgo ? (
          <View className="flex-row items-center gap-1">
            <Ionicons name="sync-outline" size={11} color={palette.mutedForeground} />
            <Text className="text-2xs text-muted-foreground">{checkAgo}</Text>
          </View>
        ) : null}
      </View>

      <View className="flex-row items-center gap-1">
        <Ionicons name="time-outline" size={12} color={palette.mutedForeground} />
        <Text className="text-2xs text-muted-foreground">
          Оновлено: <Text className="font-medium text-foreground">{updatedText}</Text>
        </Text>
      </View>
    </View>
  );
}
