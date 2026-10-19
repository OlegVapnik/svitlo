import { useCallback, useEffect, useState } from 'react';

import {
  getStoredQueueForRegion,
  setStoredQueueForRegion,
} from '@svitlo/core/lib/region-queue';

/**
 * Выбранная группа (черга) для области.
 *
 * Логика выбора и приоритетов (сохранённая группа → legacy-закладки → первая доступная) живёт в
 * `@svitlo/core/lib/region-queue`; хук только держит её в состоянии React и перечитывает при
 * смене области или списка доступных групп.
 */
export function useRegionQueue(regionCpu: string, availableQueues: string[] = []) {
  const [selectedQueue, setSelectedQueueState] = useState<string | null>(() =>
    getStoredQueueForRegion(regionCpu, availableQueues),
  );

  useEffect(() => {
    setSelectedQueueState(getStoredQueueForRegion(regionCpu, availableQueues));
  }, [regionCpu, availableQueues]);

  const selectQueue = useCallback(
    (queue: string) => {
      setSelectedQueueState(queue);
      setStoredQueueForRegion(regionCpu, queue);
    },
    [regionCpu],
  );

  return { selectedQueue, selectQueue };
}
