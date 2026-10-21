import { NativeModules, Platform } from 'react-native';

import type { NotificationBanner } from '@/lib/notification-banner';

/**
 * Мост к нативному виджету (`SvitloWidgetModule`).
 *
 * Виджет живёт вне React и обновляется системой, поэтому обмен односторонний: приложение
 * складывает снимок состояния в `SharedPreferences`, виджет перерисовывается. Обратно
 * приходят только клики по зонам — их забирает `consumeAction` и сразу очищает.
 */
interface SvitloWidgetBridge {
  update(payload: string): void;
  consumeAction(): Promise<string | null>;
  clear(): void;
  /** Имя drawable для плашки в шторке; приходит из нативного `getConstants()`. */
  notificationIcon?: string;
}

export type WidgetAction = 'refresh' | 'next_queue';

const bridge: SvitloWidgetBridge | undefined = NativeModules.SvitloWidget;

/**
 * Имя иконки для `smallIcon` постоянной плашки.
 *
 * Приходит из нативного модуля, а не из литерала: ресурс обязан быть статически
 * использован в Kotlin, иначе `shrinkResources` вырезает drawable и уведомление не показывается.
 * Здесь это ещё и единственный источник имени — JS и Android не расходятся.
 */
export function notificationIconName(): string {
  return bridge?.notificationIcon ?? 'ic_stat_svitlo';
}

/** Виджеты есть только в Android-сборке: в web/ios вызовы молча ничего не делают. */
export function isWidgetAvailable(): boolean {
  return Platform.OS === 'android' && bridge != null;
}

/**
 * Отдаёт виджету тот же снимок, что и плашку уведомления: одно состояние — одно изображение.
 *
 * JSON плоский и короткий: нативный рендер ждёт ровно эти поля (см. `WidgetPayload.kt`),
 * лишние он игнорирует. `slots` — 48 получасовых кодов, `nowFraction` — позиция «зараз».
 */
export function pushWidgetSnapshot(banner: NotificationBanner, updatedAt = Date.now()): void {
  if (!bridge) return;
  const payload = {
    state: banner.state,
    headline: banner.headline,
    detail: banner.detail,
    pill: banner.pill,
    timer: banner.timer?.value ?? null,
    timerPrefix: banner.timer?.prefix ?? null,
    queue: banner.queue,
    slots: banner.slots,
    nowFraction: banner.nowFraction,
    offMinutes: banner.offMinutes,
    updatedAt,
  };
  try {
    bridge.update(JSON.stringify(payload));
  } catch {
    /* виджет не установлен/модуль недоступен — экран из-за этого падать не должен */
  }
}

/** Забирает отложенное действие клика по зоне виджета. */
export async function consumeWidgetAction(): Promise<WidgetAction | null> {
  if (!bridge) return null;
  try {
    const action = await bridge.consumeAction();
    return action === 'refresh' || action === 'next_queue' ? action : null;
  } catch {
    return null;
  }
}

/** Сброс данных виджета: он вернётся к честной заглушке «немає даних». */
export function clearWidget(): void {
  if (!bridge) return;
  try {
    bridge.clear();
  } catch {
    /* нечего очищать */
  }
}
