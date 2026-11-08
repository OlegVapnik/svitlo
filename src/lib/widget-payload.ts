import type { NotificationBanner } from '@/lib/notification-banner';
import type { WidgetWindowRange } from '@/lib/widget-windows';

/**
 * Формат снимка для нативного виджета — без React Native.
 *
 * Вынесено из `widget.ts` по той же причине, что `ingest-parse.ts` из `ingest.ts`: модуль с
 * `NativeModules` нельзя запустить в Node, а формат снимка — единственный контракт между JS и
 * Kotlin (`WidgetPayload.kt`). Если поле переименовать только здесь, виджет молча покажет «немає
 * даних» — тест ловит это до сборки APK.
 */

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
  /**
   * Только название места: «🏠 Дім» или «Мій графік».
   *
   * Раньше сюда приезжало «🏠 Дім · 6/1», и в виджете 2×1 текст с очередью не помещался:
   * лаунчер обрезал половинку кода. Теперь место и очередь — два отдельных поля и в макете
   * два отдельных TextView.
   */
  placeLabel: string;
  /** Код группы отдельно от названия: «6/1», «35/1». Пустая строка — очередь не выбрана. */
  queueLabel?: string;
  /** Окна отключений на сегодня (epoch-ms пары), см. `widget-windows.ts`. */
  windowsToday?: WidgetWindowRange[];
  /** Окна отключений на завтра; пусто — график не опубликован. */
  windowsTomorrow?: WidgetWindowRange[];
  /** Скільки хвилин без світла за сьогодні; `null` — графіка немає. */
  todayOffMinutes: number | null;
  /** Скільки хвилин без світла завтра; `null` — графік ще не опубліковано. */
  tomorrowOffMinutes: number | null;
  /** Відсоток пройденого інтервалу (0..100) для змейки Squiggly Seekbar. */
  progress?: number | null;
  /** До трьох місць для віджета «Радар». */
  places: WidgetPlaceSnapshot[];
}

/** Снимок целиком: ровно те, что читает `WidgetPayload.kt`. */
export interface WidgetPayload {
  state: string;
  headline: string;
  detail: string;
  pill: string;
  timer: string;
  timerPrefix: string;
  queue: string;
  slots: (number | null)[];
  nowFraction: number | null;
  offMinutes: number;
  updatedAt: number;
  placeLabel: string;
  queueLabel: string;
  /** Пары `[начало, конец]` в epoch-ms: Kotlin считает по ним живой обратный отсчёт. */
  windowsToday: WidgetWindowRange[];
  windowsTomorrow: WidgetWindowRange[];
  todayOffMinutes: number | null;
  tomorrowOffMinutes: number | null;
  progress: number | null;
  places: WidgetPlaceSnapshot[];
}

/**
 * Собирает плоский JSON для виджета.
 *
 * Правила, которые нельзя размазывать по нативному коду:
 *  - без таймера при живом свете пишем «Світло є», а не «—»: иначе виджет врёт о причине;
 *  - отсутствующие extras не превращаются в «0 хв» — только `null`, чтобы Kotlin показал «—»;
 *  - `places` по умолчанию пустой массив, а не undefined: нативный JSON-парсер ждёт массив.
 */
export function buildWidgetPayload(
  banner: NotificationBanner,
  extras?: WidgetSnapshotExtras,
  updatedAt = Date.now(),
): WidgetPayload {
  return {
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
    queueLabel: extras?.queueLabel || banner.queue || '',
    windowsToday: extras?.windowsToday ?? [],
    windowsTomorrow: extras?.windowsTomorrow ?? [],
    todayOffMinutes: extras?.todayOffMinutes ?? null,
    tomorrowOffMinutes: extras?.tomorrowOffMinutes ?? null,
    progress: extras?.progress ?? null,
    places: extras?.places ?? [],
  };
}
