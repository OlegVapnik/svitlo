import { useCallback, useSyncExternalStore } from 'react';
import {
  MAX_SAVED_PLACES,
  addSavedPlaceToStore,
  loadSavedPlaces,
  moveSavedPlaceInStore,
  normalizeSavedPlaceOrderInStore,
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
  MAX_PLACE_LABEL_LENGTH,
  MAX_SAVED_PLACES,
  PLACE_ICONS,
  defaultPlaceLabel,
  sanitizePlaceLabel,
} from '@svitlo/core/lib/saved-places';

/**
 * Збережені місця в застосунку.
 *
 * Стан і правила — у `@svitlo/core/lib/saved-places-store`, тому мобільний і веб не
 * розходяться в міграції, ліміті чи дедуплікації. Хук лише дає React-підписку.
 */
export function useSavedPlaces() {
  const places = useSyncExternalStore(subscribeSavedPlaces, loadSavedPlaces, loadSavedPlaces);
  const primaryPlace = places.find((place) => place.isPrimary) ?? places[0] ?? null;

  const addPlace = useCallback(
    (input: AddPlaceInput): AddPlaceResult => addSavedPlaceToStore(input),
    [],
  );

  const renamePlace = useCallback((id: string, label: string) => {
    renameSavedPlaceInStore(id, label);
  }, []);

  const setPlaceIcon = useCallback((id: string, icon: PlaceIcon) => {
    setSavedPlaceIconInStore(id, icon);
  }, []);

  const setPlaceQueue = useCallback((id: string, queue: string) => {
    setSavedPlaceQueueInStore(id, queue);
  }, []);

  const setPrimaryPlace = useCallback((id: string) => {
    setSavedPlacePrimaryInStore(id);
  }, []);

  const movePlace = useCallback((id: string, direction: -1 | 1) => {
    moveSavedPlaceInStore(id, direction);
  }, []);

  const removePlace = useCallback((id: string) => removeSavedPlaceFromStore(id), []);

  const restorePlace = useCallback((place: SavedPlace, index: number) => {
    restoreSavedPlaceToStore(place, index);
  }, []);

  const normalizeOrder = useCallback(() => {
    normalizeSavedPlaceOrderInStore();
  }, []);

  return {
    places,
    primaryPlace,
    canAdd: places.length < MAX_SAVED_PLACES,
    addPlace,
    removePlace,
    restorePlace,
    setPrimaryPlace,
    renamePlace,
    setPlaceIcon,
    setPlaceQueue,
    movePlace,
    normalizeOrder,
  };
}
