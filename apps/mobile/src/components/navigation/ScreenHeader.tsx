import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { formatKyivMoment } from '@svitlo/core/lib/date';

import { RegionPicker } from '@/components/home/RegionPicker';
import { useSyncStatus } from '@/context/SyncContext';
import { useTheme } from '@/theme/ThemeProvider';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Дії під заголовком: оновлення, «поділитися». */
  actions?: ReactNode;
}

/**
 * Одна шапка на всі вкладки.
 *
 * До неї кожен екран малював свою: на Головній був лише вибір області з двома кнопками, на
 * Пошуку/Моніторі/Інфо — заголовок із підписом. Через це при перемиканні вкладок шапка стрибала
 * по висоті й по горизонталі, а кнопки оновлення жили тільки на головній.
 *
 * Правило одне: перший рядок — назва екрана й вибір області (область є на кожному екрані й
 * означає одне й те саме), другий — підпис стану й дії. Дії стоять праворуч під областю, тому
 * вони не змагаються за ширину з довгою назвою («Дніпропетровська область»).
 */
export function ScreenHeader({ title, subtitle, actions }: ScreenHeaderProps) {
  const { palette } = useTheme();
  const { state } = useSyncStatus();

  const syncTone =
    state.phase === 'offline'
      ? palette.status.off
      : state.phase === 'idle'
        ? palette.status.unknown
        : state.phase === 'syncing'
          ? palette.status.warning
          : palette.status.on;
  const syncLabel =
    state.phase === 'syncing'
      ? 'Оновлення…'
      : state.phase === 'offline'
        ? 'Офлайн-дані'
        : state.phase === 'idle'
          ? 'Немає даних'
          : state.checkedAt
            ? `Оновлено ${formatKyivMoment(state.checkedAt)}`
            : 'Є офлайн-пакет';

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Text numberOfLines={1} className="flex-1 text-2xl font-bold tracking-tight text-foreground">
          {title}
        </Text>
        <RegionPicker />
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-0.5">
          {subtitle ? (
            <Text numberOfLines={2} className="text-xs text-muted-foreground">
              {subtitle}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-1.5">
            <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: syncTone.color }} />
            <Text className="text-[11px] font-medium" style={{ color: syncTone.text }}>
              {syncLabel}
            </Text>
          </View>
        </View>
        {actions ? <View className="flex-row items-center gap-2">{actions}</View> : null}
      </View>
    </View>
  );
}
