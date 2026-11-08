/**
 * Web-заглушка містка до Android-віджета.
 *
 * Віджет — це RemoteViews в APK; у браузері такого поняття немає. Снимок просто нікуди не
 * йде, а екшени завжди порожні: жоден екран не повинен знати, що віджета тут не буде.
 */
import type { NotificationBanner } from '@/lib/notification-banner';

export type WidgetAction = 'refresh' | 'next_queue' | 'cycle_bookmark';

export type { WidgetPlaceSnapshot, WidgetSnapshotExtras } from '@/lib/widget-payload';

export function notificationIconName(): string {
  return 'ic_stat_svitlo';
}

export function isWidgetAvailable(): boolean {
  return false;
}

export function pushWidgetSnapshot(
  _banner: NotificationBanner,
  _extras?: import('@/lib/widget-payload').WidgetSnapshotExtras,
  _updatedAt = Date.now(),
): void {
  /* віджета в браузері немає */
}

export async function consumeWidgetAction(): Promise<WidgetAction | null> {
  return null;
}

export function clearWidget(): void {
  /* нічого не очищати */
}
