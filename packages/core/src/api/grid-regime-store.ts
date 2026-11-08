/**
 * Режим мережі (ГАВ/СГАВ/ГПВ/ГОП) — крихітне сховище поверх офлайн-пакета.
 *
 * `/sync` уже приносить `gridRegime` разом із графіком, тому окремий запит не потрібен:
 * `applyBundle` (див. `offline-sync.ts`) кладе значення сюди, а екрани читають його через
 * `useSyncExternalStore`. Так банер зʼявляється одразу після гідратації з диска — ще до
 * першого мережевого запиту, і не блимає «немає режиму» на кожному ререндері.
 *
 * Чому не React Query: це не запит, а поле вже завантаженого пакета. Окремий ключ запиту
 * довелося б наповнювати вручну й чистити при зміні області — рівно те саме, що робить цей
 * модуль, але з більшою кількістю рухомих частин.
 */
import type { GridRegimeSnapshot } from '@svitlo/shared';

type Listener = () => void;

let current: GridRegimeSnapshot | null = null;
/**
 * Область, для якої зібрано поточний режим.
 *
 * `GridRegimeSnapshot` не містить регіону, а `/sync` повертає режим лише для вибраної області.
 * Без цього поля застарілий ГАВ «прилипав» до будь-якої області, яку щойно вибрали на карті:
 * людина клікала на зелену область, а та ставала бордовою від режиму попередньої.
 */
let currentRegion: string | null = null;
const listeners = new Set<Listener>();

/** Останній режим мережі або `null`, якщо у свіжих новинах його немає. */
export function getGridRegime(): GridRegimeSnapshot | null {
  return current;
}

/** `cpu`/feed-ключ області, до якої належить поточний режим; `null`, якщо невідомо. */
export function getGridRegimeRegion(): string | null {
  return currentRegion;
}

/** Оновлює режим і повідомляє підписників. Однакове значення не викликає зайвий рендер. */
export function setGridRegime(
  next: GridRegimeSnapshot | null | undefined,
  region?: string | null,
): void {
  const value = next ?? null;
  const nextRegion = value ? (region ?? null) : null;
  if (value === current && nextRegion === currentRegion) return;
  current = value;
  currentRegion = nextRegion;
  for (const listener of listeners) listener();
}

/** Підписка для `useSyncExternalStore`. Повертає функцію відписки. */
export function subscribeGridRegime(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Скидання між тестами й при зміні області, якщо пакет прийшов без режиму. */
export function resetGridRegime(): void {
  setGridRegime(null);
}
