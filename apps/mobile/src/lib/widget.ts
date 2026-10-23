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

export type WidgetAction = 'refresh' | 'next_queue' | 'cycle_bookmark';

/** Одно збережене місце для віджета «Радар моїх місць». */
export interface WidgetPlaceSnapshot {
  /** Емодзі іконки місця: 🏠, 💼, 🌳 тощо. */
  icon: string;
  label: string;
  queue: string;
  /** `on` | `warning` | `off` | `unknown` — той самий стан, що в Hero-картці. */
  state: string;
  /** Короткий час: «до 09:00», «цілий день», порожньо. */
  timeLabel: string;
  /** Підпис: «Світло є», «Скоро вимкнуть», «Вимкнено», «Немає даних». */
  statusText: string;
}

/**
 * Додаткові поля віджета, яких немає у плашці шторки.
 *
 * Нативні макети — декларативні `RemoteViews`: увесь текст і кнопки малює система, тому
 * заздалегідь відформатовані рядки приходять звідси. Це тримає одну логіку форматування
 * (JS) і не дублює українські відмінки в Kotlin.
 */
export interface WidgetSnapshotExtras {
  /** «🏠 Дім · 6/1» або «Черга 6/1», якщо місце не збережене. */
  placeLabel: string;
  /** Скільки хвилин без світла за сьогодні; `null` — графіка немає. */
  todayOffMinutes: number | null;
  /** Скільки хвилин без світла завтра; `null` — графік ще не опубліковано. */
  tomorrowOffMinutes: number | null;
  /** Відсоток пройденого інтервалу (0..100) для змейки Squiggly Seekbar. */
  progress?: number | null;
  /** До трьох місць для віджета «Радар». */
  places: WidgetPlaceSnapshot[];
}

interface SvitloSharedDefaultsBridge {
  setPayload(payload: string): void;
}

const bridge: SvitloWidgetBridge | undefined = NativeModules.SvitloWidget;
const sharedDefaults: SvitloSharedDefaultsBridge | undefined = NativeModules.SvitloSharedDefaults;

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
export function pushWidgetSnapshot(
  banner: NotificationBanner,
  extras?: WidgetSnapshotExtras,
  updatedAt = Date.now(),
): void {
  const payload = {
    state: banner.state,
    headline: banner.headline,
    detail: banner.detail || '',
    pill: banner.pill || 'Світло є',
    timer: banner.timer?.value || (banner.state === 'on' || banner.state === 'allClear' ? 'Світло є' : '—'),
    timerPrefix: banner.timer?.prefix || '',
    queue: banner.queue || '',
    slots: banner.slots,
    nowFraction: banner.nowFraction,
    offMinutes: banner.offMinutes,
    updatedAt,
    placeLabel: extras?.placeLabel || 'Мій графік',
    todayOffMinutes: extras?.todayOffMinutes ?? null,
    tomorrowOffMinutes: extras?.tomorrowOffMinutes ?? null,
    progress: extras?.progress ?? null,
    places: extras?.places ?? [],
  };
  const serialized = JSON.stringify(payload);
  if (bridge) {
    try {
      bridge.update(serialized);
    } catch {
      /* виджет не установлен/модуль недоступен — экран из-за этого падать не должен */
    }
  }
  // На iOS виджетного расширения пока нет, но контейнер App Group уже общий: кладём тот же
  // снимок в `UserDefaults(suiteName:)`, чтобы расширение могло читать его без переделки JS.
  if (Platform.OS === 'ios' && sharedDefaults) {
    try {
      sharedDefaults.setPayload(serialized);
    } catch {
      /* модуль не подключён в этой сборке — молча пропускаем */
    }
  }
}

/** Забирает отложенное действие клика по зоне виджета. */
export async function consumeWidgetAction(): Promise<WidgetAction | null> {
  if (!bridge) return null;
  try {
    const action = await bridge.consumeAction();
    return action === 'refresh' || action === 'next_queue' || action === 'cycle_bookmark'
      ? action
      : null;
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
