import { useCallback, useSyncExternalStore } from 'react';
import {
  LEGACY_BOOKMARKS_KEY,
  MAX_SAVED_PLACES,
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
} from '../lib/saved-places.js';

export type { AddPlaceInput, AddPlaceResult, PlaceIcon, SavedPlace };
export {
  MAX_SAVED_PLACES,
  PLACE_ICONS,
  defaultPlaceLabel,
  sanitizePlaceLabel,
} from '../lib/saved-places.js';

/** Історична назва типу: закладка = збережене місце. Поля ті самі, тому код-споживач не ламається. */
export type Bookmark = SavedPlace;

/**
 * Спільний стан збережених місць.
 *
 * Чому зовнішнє сховище, а не `useState` у хуку: місця редагуються з пʼяти екранів (головна,
 * пошук адреси, «Мої черги», майстер адреси). Раніше кожен `useBookmarks` тримав власну копію,
 * тому перейменування в одному місці не було видно в іншому до перемонтування компонента.
 * `useSyncExternalStore` дає один стан на застосунок без context-провайдера.
 */
let cache: SavedPlace[] | null = null;
const listeners = new Set<() => void>();
let storageBound = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function writeCache(
  places: SavedPlace[],
  options: { persist?: boolean } = {},
): SavedPlace[] {
  cache = places;
  if (options.persist !== false && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SAVED_PLACES_KEY, serializeSavedPlaces(places));
      // Старий ключ прибираємо тільки ПІСЛЯ успішного запису нового: інакше при переповненні
      // сховища міграція втратила б і стару копію, і нову.
      localStorage.removeItem(LEGACY_BOOKMARKS_KEY);
    } catch {
      // Квота або приватний режим: працюємо в памʼяті, застосунок не падає.
    }
  }
  return cache;
}

function getSnapshot(): SavedPlace[] {
  if (cache) return cache;
  if (typeof localStorage === 'undefined') {
    cache = [];
    return cache;
  }
  const { raw, migrated } = readRawSavedPlaces(localStorage);
  const places = migrateSavedPlaces(raw);
  // Міграцію записуємо одразу (без emit — ми всередині рендера), щоб наступний запуск
  // уже читав новий формат і не мігрував повторно.
  return writeCache(places, { persist: migrated && places.length > 0 });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageBound && typeof window !== 'undefined') {
    storageBound = true;
    // Інша вкладка змінила місця — підхоплюємо без перезавантаження.
    window.addEventListener('storage', (event) => {
      if (event.key !== null && event.key !== SAVED_PLACES_KEY) return;
      cache = null;
      getSnapshot();
      emit();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

function update(next: SavedPlace[]): void {
  writeCache(next);
  emit();
}

/**
 * Читає місця поза React: фонова перевірка сповіщень про відключення не має компонента.
 * Експорт збережено з часів закладок — на ньому тримається `useOutageNotifications`.
 */
export function loadBookmarks(): SavedPlace[] {
  return getSnapshot();
}

/** Повний список місць (для не-React коду й тестів). */
export const loadSavedPlaces = loadBookmarks;

/**
 * Збережені місця з усієї України.
 *
 * На відміну від `useMyQueues` (масив рядків без області), місце несе свою область,
 * населений пункт і вулицю — тому графік запитується по `regionCpu` місця, а не по
 * глобальній поточній області.
 */
export function useBookmarks() {
  const places = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const bookmarks = places;
  const primaryBookmark = places.find((place) => place.isPrimary) ?? places[0] ?? null;

  /** Додає місце. Повертає його id (порожній рядок, якщо додати не вдалося). */
  const addBookmark = useCallback((input: AddPlaceInput): string => {
    const result = addSavedPlace(getSnapshot(), input);
    if (result.ok) {
      update(result.places);
      return result.place.id;
    }
    // Для сумісності зі старими формами: дублікат повертає id існуючого місця, щоб
    // викликач міг одразу зробити його головним.
    return result.duplicate?.id ?? '';
  }, []);

  /** Те саме, але з причиною відмови — для форми, яка показує «уже є» або «ліміт». */
  const addPlace = useCallback((input: AddPlaceInput): AddPlaceResult => {
    const result = addSavedPlace(getSnapshot(), input);
    if (result.ok) update(result.places);
    return result;
  }, []);

  /**
   * Перейменувати місце («Дім» → «Офіс»). Порожня назва не стирає стару: людина могла
   * випадково стерти текст і натиснути «Готово».
   */
  const renameBookmark = useCallback((id: string, label: string) => {
    update(renameSavedPlace(getSnapshot(), id, label));
  }, []);

  const setBookmarkIcon = useCallback((id: string, icon: PlaceIcon) => {
    update(setSavedPlaceIcon(getSnapshot(), id, icon));
  }, []);

  const setBookmarkQueue = useCallback((id: string, queue: string) => {
    update(setSavedPlaceQueue(getSnapshot(), id, queue));
  }, []);

  /** Видаляє місце і повертає його разом із позицією — для undo протягом кількох секунд. */
  const removeBookmark = useCallback(
    (id: string): { place: SavedPlace; index: number } | null => {
      const current = getSnapshot();
      const index = current.findIndex((place) => place.id === id);
      if (index < 0) return null;
      const place = current[index]!;
      update(removeSavedPlace(current, id));
      return { place, index };
    },
    [],
  );

  /** Повертає видалене місце на його позицію (не в кінець списку). */
  const restoreBookmark = useCallback((place: SavedPlace, index: number) => {
    update(restoreSavedPlace(getSnapshot(), place, index));
  }, []);

  const setPrimaryBookmark = useCallback((id: string) => {
    update(setSavedPlacePrimary(getSnapshot(), id));
  }, []);

  const moveBookmark = useCallback((id: string, direction: -1 | 1) => {
    update(moveSavedPlace(getSnapshot(), id, direction));
  }, []);

  /** Скидання головного місця після ручних правок у DevTools / битого сховища. */
  const normalizeOrder = useCallback(() => {
    update(ensurePrimary(getSnapshot()));
  }, []);

  return {
    places,
    bookmarks,
    primaryBookmark,
    canAdd: places.length < MAX_SAVED_PLACES,
    addBookmark,
    addPlace,
    removeBookmark,
    restoreBookmark,
    setPrimaryBookmark,
    renameBookmark,
    setBookmarkIcon,
    setBookmarkQueue,
    moveBookmark,
    normalizeOrder,
  };
}


