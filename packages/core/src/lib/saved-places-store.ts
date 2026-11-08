/**
 * Спільне сховище збережених місць для веба й React Native.
 *
 * Бізнес-правила (ліміт, дедуплікація, міграція v1→v2) лежать у `saved-places.ts`; тут — лише
 * синхронний кеш, запис у платформний `storage` і підписка. Жодного React чи `localStorage`:
 * веб-хук і мобільний хук — тонкі обгортки над цим модулем, тому перейменування місця на
 * одному екрані одразу бачить інший.
 */

import { storage } from '../storage';
import {
  LEGACY_BOOKMARKS_KEY,
  SAVED_PLACES_KEY,
  addSavedPlace,
  ensurePrimary,
  migrateSavedPlaces,
  moveSavedPlace,
  readRawSavedPlaces,
  removeSavedPlace,
  renameSavedPlace,
  restoreSavedPlace,
  serializeSavedPlaces,
  setSavedPlaceIcon,
  setSavedPlacePrimary,
  setSavedPlaceQueue,
  type AddPlaceInput,
  type AddPlaceResult,
  type PlaceIcon,
  type SavedPlace,
} from './saved-places';

let cache: SavedPlace[] | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function writeCache(places: SavedPlace[], persist = true): SavedPlace[] {
  cache = places;
  if (persist) {
    try {
      storage.setItem(SAVED_PLACES_KEY, serializeSavedPlaces(places));
      // Старий ключ прибираємо тільки ПІСЛЯ успішного запису нового: інакше при переповненні
      // сховища міграція втратила б і стару копію, і нову.
      storage.removeItem(LEGACY_BOOKMARKS_KEY);
    } catch {
      // Квота або приватний режим: працюємо в памʼяті, застосунок не падає.
    }
  }
  return cache;
}

/** Поточний список без React: для фонових перевірок і тестів. */
export function loadSavedPlaces(): SavedPlace[] {
  if (cache) return cache;
  const { raw, migrated } = readRawSavedPlaces(storage);
  const places = migrateSavedPlaces(raw);
  // Міграцію записуємо одразу, щоб наступний запуск уже читав новий формат.
  return writeCache(places, migrated && places.length > 0);
}

/** Сумісна історична назва: закладка = збережене місце. */
export const loadBookmarks = loadSavedPlaces;

export function subscribeSavedPlaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Перечитує сховище (наприклад, після зміни в іншій вкладці браузера). */
export function refreshSavedPlaces(): void {
  cache = null;
  loadSavedPlaces();
  emit();
}

function update(next: SavedPlace[]): void {
  writeCache(next);
  emit();
}

export function addSavedPlaceToStore(input: AddPlaceInput): AddPlaceResult {
  const result = addSavedPlace(loadSavedPlaces(), input);
  if (result.ok) update(result.places);
  return result;
}

export function removeSavedPlaceFromStore(id: string): { place: SavedPlace; index: number } | null {
  const current = loadSavedPlaces();
  const index = current.findIndex((place) => place.id === id);
  if (index < 0) return null;
  const place = current[index]!;
  update(removeSavedPlace(current, id));
  return { place, index };
}

export function restoreSavedPlaceToStore(place: SavedPlace, index: number): void {
  update(restoreSavedPlace(loadSavedPlaces(), place, index));
}

export function renameSavedPlaceInStore(id: string, label: string): void {
  update(renameSavedPlace(loadSavedPlaces(), id, label));
}

export function setSavedPlaceIconInStore(id: string, icon: PlaceIcon): void {
  update(setSavedPlaceIcon(loadSavedPlaces(), id, icon));
}

export function setSavedPlaceQueueInStore(id: string, queue: string): void {
  update(setSavedPlaceQueue(loadSavedPlaces(), id, queue));
}

export function setSavedPlacePrimaryInStore(id: string): void {
  update(setSavedPlacePrimary(loadSavedPlaces(), id));
}

export function moveSavedPlaceInStore(id: string, direction: -1 | 1): void {
  update(moveSavedPlace(loadSavedPlaces(), id, direction));
}

export function normalizeSavedPlaceOrderInStore(): void {
  update(ensurePrimary(loadSavedPlaces()));
}

export { MAX_SAVED_PLACES, SAVED_PLACES_KEY } from './saved-places';
export type {
  AddPlaceInput,
  AddPlaceResult,
  PlaceIcon,
  SavedPlace,
} from './saved-places';
