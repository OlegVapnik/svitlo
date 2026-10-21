import { useCallback, useSyncExternalStore } from 'react';
import {
  MAX_SAVED_PLACES,
  SAVED_PLACES_KEY,
  addSavedPlaceToStore,
  loadSavedPlaces as loadStoredSavedPlaces,
  moveSavedPlaceInStore,
  normalizeSavedPlaceOrderInStore,
  refreshSavedPlaces,
  removeSavedPlaceFromStore,
  renameSavedPlaceInStore,
  restoreSavedPlaceToStore,
  setSavedPlaceIconInStore,
  setSavedPlacePrimaryInStore,
  setSavedPlaceQueueInStore,
  subscribeSavedPlaces,
  type AddPlaceInput,
  type AddPlaceResult,
  type PlaceIcon,
  type SavedPlace,
} from '@svitlo/core/lib/saved-places-store';

export type { AddPlaceInput, AddPlaceResult, PlaceIcon, SavedPlace };
export {
  MAX_SAVED_PLACES,
  PLACE_ICONS,
  defaultPlaceLabel,
  sanitizePlaceLabel,
} from '@svitlo/core/lib/saved-places';

/** Історична назва типу: закладка = збережене місце. Поля ті самі, тому код-споживач не ламається. */
export type Bookmark = SavedPlace;

/**
 * Веб-обгортка над спільним сховищем `@svitlo/core`.
 *
 * Сам стан, міграція й правила живуть у ядрі, тому мобільний застосунок бачить ті самі місця.
 * Тут лишається React-підписка та синхронізація між вкладками браузера.
 */
let storageBound = false;

function bindStorageEvents(): void {
  if (storageBound || typeof window === 'undefined') return;
  storageBound = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== SAVED_PLACES_KEY) return;
    refreshSavedPlaces();
  });
}

function getSnapshot(): SavedPlace[] {
  bindStorageEvents();
  return loadStoredSavedPlaces();
}

function subscribe(listener: () => void): () => void {
  bindStorageEvents();
  return subscribeSavedPlaces(listener);
}

/** Читає місця поза React: фонова перевірка сповіщень про відключення не має компонента. */
export function loadBookmarks(): SavedPlace[] {
  return loadStoredSavedPlaces();
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
    const result = addSavedPlaceToStore(input);
    if (result.ok) return result.place.id;
    // Для сумісності зі старими формами: дублікат повертає id існуючого місця, щоб
    // викликач міг одразу зробити його головним.
    return result.duplicate?.id ?? '';
  }, []);

  /** Те саме, але з причиною відмови — для форми, яка показує «уже є» або «ліміт». */
  const addPlace = useCallback((input: AddPlaceInput): AddPlaceResult => addSavedPlaceToStore(input), []);

  const renameBookmark = useCallback((id: string, label: string) => {
    renameSavedPlaceInStore(id, label);
  }, []);

  const setBookmarkIcon = useCallback((id: string, icon: PlaceIcon) => {
    setSavedPlaceIconInStore(id, icon);
  }, []);

  const setBookmarkQueue = useCallback((id: string, queue: string) => {
    setSavedPlaceQueueInStore(id, queue);
  }, []);

  /** Видаляє місце і повертає його разом із позицією — для undo протягом кількох секунд. */
  const removeBookmark = useCallback((id: string) => removeSavedPlaceFromStore(id), []);

  /** Повертає видалене місце на його позицію (не в кінець списку). */
  const restoreBookmark = useCallback((place: SavedPlace, index: number) => {
    restoreSavedPlaceToStore(place, index);
  }, []);

  const setPrimaryBookmark = useCallback((id: string) => {
    setSavedPlacePrimaryInStore(id);
  }, []);

  const moveBookmark = useCallback((id: string, direction: -1 | 1) => {
    moveSavedPlaceInStore(id, direction);
  }, []);

  /** Скидання головного місця після ручних правок у DevTools / битого сховища. */
  const normalizeOrder = useCallback(() => {
    normalizeSavedPlaceOrderInStore();
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
