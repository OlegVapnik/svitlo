/**
 * Локальні сповіщення про відключення й повернення світла.
 *
 * Задача: людина має дізнатися про відключення ДО того, як воно станеться, а не коли вже
 * зникло світло. Графік лежить у кеші TanStack Query (його наповнює офлайн-пакет), тому джерело
 * для попередження працює й без мережі: якщо вчорашній пакет знає, що черга 2/2 вимикається
 * о 14:00, попередження прийде і сьогодні в офлайні.
 *
 * Чому окремо від UI. Правила «коли саме попереджати» — це чиста арифметика над інтервалами
 * (`collectUpcomingAlerts`), і її покриває тест. Доставка (Notification API / Service Worker)
 * відокремлена, бо від неї залежить тільки «чи показали», а не «чи мали показати».
 *
 * Що тут чесно, а не «як хотілося б»: без Service Worker Android Chrome забороняє створювати
 * сповіщення зі сторінки (кидає TypeError), а Capacitor-збірка WebView не має Notification API
 * взагалі. Тому `showLocalNotification` повертає факт показу, і застосунок не вважає людину
 * попередженою, якщо сповіщення реально не з'явилося. Інакше попередження мовчки зникали б, і
 * людина дізнавалася б про відключення разом із вимкненим світлом.
 *
 * Обмеження, які треба знати: без push-сервера сповіщення працюють лише поки застосунок
 * відкритий (таймер у вкладці). Це не мовчазний компроміс — текст у налаштуваннях каже це прямо.
 */
import type { GroupOutageSummary } from '@svitlo/shared';
import { isQueueCode, normalizeQueueCode } from './queue.js';

/** За скільки хвилин попереджаємо про початок відключення. */
export const OUTAGE_LEAD_MINUTES = 30;
/** За скільки хвилин попереджаємо про повернення світла. */
export const RESTORE_LEAD_MINUTES = 15;

const MS_PER_MINUTE = 60_000;

/** Ключ сховища вже показаних попереджень. Версія в імені — щоб старий формат не глушив нові. */
const NOTIFIED_KEY = 'svitlo:notified-alerts:v1';
/** Скільки живемо в списку показаних. Більше доби не потрібно: графік на 2 дні, а ключ містить час. */
const NOTIFIED_TTL_MS = 36 * 60 * MS_PER_MINUTE;

/** Тип попередження: світло зникне або повернеться. */
export type OutageAlertKind = 'starting' | 'restoring';

/** Мінімум, потрібний від інтервалу графіка: черга та її межі. */
export interface OutageAlertInterval {
  queue: string;
  startsAt: string;
  endsAt: string;
}

export interface OutageAlert {
  /** Ключ дедуплікації: одна межа одного відключення згадується рівно один раз. */
  key: string;
  kind: OutageAlertKind;
  queue: string;
  /** Момент, про який попереджаємо (ISO): початок відключення або його кінець. */
  at: string;
  /** Скільки хвилин лишилося на момент перевірки — з цього складається текст сповіщення. */
  minutesLeft: number;
}

/** Ключ попередження. Час у ключі обов'язковий: графік на завтра має свій окремий ключ. */
export function alertKey(kind: OutageAlertKind, queue: string, iso: string): string {
  return `${kind}:${queue}:${iso}`;
}

/**
 * Відбирає попередження з інтервалів на момент `now`.
 *
 * Правила навмисно вузькі, щоб не спамити:
 *   - про початок — лише коли до нього лишилося ≤ 30 хвилин і воно ще не почалося;
 *   - про кінець — лише коли лишилося ≤ 15 хвилин і відключення ще триває;
 *   - відключення, що вже минуло, не згадується взагалі (це вже історія, а не попередження).
 *
 * `minutesLeft` округлюємо вгору до 1, а не до 0: «за 0 хвилин» виглядає як помилка, а хвилина
 * запасу в людини справді є — це час між перевіркою й реальним початком.
 */
export function collectUpcomingAlerts(
  intervals: readonly OutageAlertInterval[],
  now: number = Date.now(),
): OutageAlert[] {
  const alerts = new Map<string, OutageAlert>();

  for (const interval of intervals ?? []) {
    const queue = normalizeQueueCode(String(interval?.queue ?? ''));
    if (!isQueueCode(queue)) continue;
    const start = Date.parse(interval.startsAt);
    const end = Date.parse(interval.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    if (start > now && start - now <= OUTAGE_LEAD_MINUTES * MS_PER_MINUTE) {
      const at = new Date(start).toISOString();
      alerts.set(alertKey('starting', queue, at), {
        key: alertKey('starting', queue, at),
        kind: 'starting',
        queue,
        at,
        minutesLeft: Math.max(1, Math.round((start - now) / MS_PER_MINUTE)),
      });
    } else if (end > now && end - now <= RESTORE_LEAD_MINUTES * MS_PER_MINUTE) {
      const at = new Date(end).toISOString();
      alerts.set(alertKey('restoring', queue, at), {
        key: alertKey('restoring', queue, at),
        kind: 'restoring',
        queue,
        at,
        minutesLeft: Math.max(1, Math.round((end - now) / MS_PER_MINUTE)),
      });
    }
  }

  // Кілька закладок на ту саму чергу дають один і той самий ключ — Map уже прибрав дублі.
  return [...alerts.values()].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

/**
 * Інтервали графіка, які стосуються названих черг.
 *
 * Одна черга може мати запис на кожну з двох діб, і обидва потрібні: попередження про 09:00
 * завтра нічим не гірше за попередження про 20:00 сьогодні.
 */
export function intervalsForQueues(
  buckets: readonly GroupOutageSummary[],
  queues: readonly string[],
): OutageAlertInterval[] {
  const wanted = new Set(queues.map((queue) => normalizeQueueCode(String(queue ?? ''))).filter(isQueueCode));
  if (wanted.size === 0) return [];

  const result: OutageAlertInterval[] = [];
  for (const bucket of buckets ?? []) {
    const code = normalizeQueueCode(String(bucket?.queue ?? ''));
    if (!wanted.has(code)) continue;
    for (const interval of bucket.intervals ?? []) {
      if (!interval?.startsAt || !interval?.endsAt) continue;
      result.push({ queue: code, startsAt: interval.startsAt, endsAt: interval.endsAt });
    }
  }
  return result;
}

// ────────────────────────── Хранилище показанных попереджень ──────────────────────────

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Приватний режим або заборона сховища: попередження не дедуплікуються, але це не привід
    // ламати показ — краще повторити, ніж не попередити.
    return null;
  }
}

function readNotified(now: number = Date.now()): Record<string, number> {
  const store = storage();
  if (!store) return {};
  try {
    const parsed = JSON.parse(store.getItem(NOTIFIED_KEY) ?? '{}') as Record<string, number>;
    if (!parsed || typeof parsed !== 'object') return {};
    const fresh: Record<string, number> = {};
    for (const [key, at] of Object.entries(parsed)) {
      if (typeof at === 'number' && now - at < NOTIFIED_TTL_MS) fresh[key] = at;
    }
    return fresh;
  } catch {
    return {};
  }
}

/** Попередження, яких ще не показували на цьому пристрої. */
export function filterUnnotified(alerts: readonly OutageAlert[], now: number = Date.now()): OutageAlert[] {
  const shown = readNotified(now);
  return alerts.filter((alert) => !(alert.key in shown));
}

/**
 * Помічає попередження як показані.
 *
 * Викликається лише після фактичного показу (або після того, як його показав інтерфейс
 * усередині застосунку). Якщо помітити «на майбутнє», сповіщення, яке не вдалося доставити,
 * зникне назавжди — і людина не дізнається про відключення.
 */
export function markNotified(alerts: readonly OutageAlert[], now: number = Date.now()): void {
  const store = storage();
  if (!store || alerts.length === 0) return;
  try {
    const next = readNotified(now);
    for (const alert of alerts) next[alert.key] = now;
    store.setItem(NOTIFIED_KEY, JSON.stringify(next));
  } catch {
    // Переповнення сховища не має ламати показ графіка — просто втрачаємо дедуплікацію.
  }
}

// ──────────────────────────────── Доставка сповіщень ────────────────────────────────

/** Чи можна взагалі показати сповіщення на цьому пристрої й що з дозволом. */
export type NotificationSupport = 'granted' | 'default' | 'denied' | 'unsupported';

export function notificationSupport(): NotificationSupport {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  const permission = Notification.permission;
  return permission === 'granted' || permission === 'denied' ? permission : 'default';
}

/**
 * Состояние доступа к сповіщенням живёт в модуле, а не в компоненте.
 *
 * Причина: спрашивают двое и независимо — движок (шапка, проверяет график) и настройки (кнопка
 * «Увімкнути сповіщення»). Если бы каждый держал свою копию, разрешение, выданное кнопкой, не
 * доходило бы до движка до перезагрузки страницы, и предупреждения не приходили бы до
 * следующего визита.
 */
let supportCache: NotificationSupport | null = null;
const supportListeners = new Set<() => void>();

export function getNotificationSupport(): NotificationSupport {
  if (supportCache === null) supportCache = notificationSupport();
  return supportCache;
}

export function subscribeNotificationSupport(listener: () => void): () => void {
  supportListeners.add(listener);
  return () => {
    supportListeners.delete(listener);
  };
}

function setNotificationSupport(next: NotificationSupport): void {
  if (supportCache === next) return;
  supportCache = next;
  for (const listener of supportListeners) listener();
}

/**
 * Запитує дозвіл на сповіщення. Викликати ТІЛЬКИ з обробника кліку: браузер вимагає жесту
 * користувача, а запит при завантаженні сторінки ігнорується або дратує відмовою назавжди.
 */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  if (notificationSupport() === 'unsupported') {
    setNotificationSupport('unsupported');
    return 'unsupported';
  }
  let next: NotificationSupport = 'default';
  try {
    const permission = await Notification.requestPermission();
    next = permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'default';
  } catch {
    next = 'default';
  }
  setNotificationSupport(next);
  return next;
}

export interface LocalNotification {
  title: string;
  body: string;
  /** Тег: сповіщення з однаковим тегом замінює попереднє, а не плодить чергу. */
  tag: string;
}

/**
 * Показує локальне сповіщення й повертає, чи воно реально з'явилося.
 *
 * Порядок доставки: спочатку Service Worker (єдиний шлях на Android Chrome), потім конструктор
 * Notification (десктоп і Safari). `false` — показати не вдалося: викликати помітку «показано»
 * в цьому випадку не можна.
 */
export async function showLocalNotification(notification: LocalNotification): Promise<boolean> {
  if (notificationSupport() !== 'granted') return false;

  const options: NotificationOptions = {
    body: notification.body,
    tag: notification.tag,
    icon: '/icons/icon.svg',
  };

  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration && typeof registration.showNotification === 'function') {
      await registration.showNotification(notification.title, options);
      return true;
    }
  } catch {
    // Падаємо на конструктор нижче: якщо SW не готовий, десктопний браузер ще може показати.
  }

  try {
    new Notification(notification.title, options);
    return true;
  } catch {
    return false;
  }
}

/** Таймер, який покаже сповіщення в заданий момент (наприклад, на початку вікна зі світлом). */
export interface ScheduledReminder {
  /** Момент срабатывания в мс (той самий, що передали). */
  at: number;
  cancel(): void;
}

/**
 * Ставить локальне сповіщення на конкретний момент.
 *
 * ПОЧЕМУ setTimeout, А НЕ PUSH. Push-сервера в проєкті немає, і обіцяти доставку при закритому
 * застосунку було б неправдою. Таймер працює, поки вкладка/WebView живі, — саме цього достатньо
 * для сценарію «увімкнути пральну машину, коли з'явиться світло»: людина тримає застосунок
 * відкритим або повертається до нього, а сповіщення все одно нагадає про початок вікна.
 *
 * `notify` інжектується для тесту: у node немає ні Notification API, ні Service Worker, зате є
 * фейкові таймери, і перевіряється саме правило «коли саме стріляє», а не доставка.
 * `null` — середовище без таймерів (SSR): викликач має показати це людині, а не вдавати успіх.
 */
export function scheduleNotificationAt(
  atMs: number,
  notification: LocalNotification,
  options: { now?: number; notify?: (payload: LocalNotification) => void | Promise<void> } = {},
): ScheduledReminder | null {
  if (typeof setTimeout !== 'function') return null;

  const now = options.now ?? Date.now();
  const notify = options.notify ?? ((payload: LocalNotification) => showLocalNotification(payload));
  const delay = Math.max(0, atMs - now);

  const timer = setTimeout(() => {
    try {
      const result = notify(notification);
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Доставка не удалась — «показано» никто не отмечает, и это честнее молчания.
    }
  }, delay);

  return { at: atMs, cancel: () => clearTimeout(timer) };
}
