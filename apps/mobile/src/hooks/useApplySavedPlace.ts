import { useCallback } from 'react';
import { setStoredQueueForRegion } from '@svitlo/core/lib/region-queue';
import type { SavedPlace } from '@svitlo/core/lib/saved-places';

import { useRegion } from '@/context/RegionContext';
import { applyRegionQueue } from '@/hooks/useRegionQueue';

/**
 * Перемикає застосунок на збережене місце: область + її чергу.
 *
 * Для іншої області спершу пишемо чергу в сховище, потім змінюємо область: `RegionContext`
 * зміниться на наступному рендері, і `useRegionQueue` прочитає вже правильний ключ. Для тієї
 * самої області досить `applyRegionQueue`, бо `setRegion` з тим самим значенням не викличе
 * перерендер і ефект не перечитає вибір.
 */
export function useApplySavedPlace() {
  const { currentRegion, setRegion } = useRegion();

  return useCallback(
    (place: SavedPlace) => {
      if (place.regionCpu === currentRegion) {
        applyRegionQueue(place.regionCpu, place.queue);
        return;
      }
      setStoredQueueForRegion(place.regionCpu, place.queue);
      setRegion(place.regionCpu);
    },
    [currentRegion, setRegion],
  );
}
