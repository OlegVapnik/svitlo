import { useCallback, useEffect, useState } from 'react';
import {
  getStoredQueueForRegion,
  setStoredQueueForRegion,
} from '../lib/region-queue.js';

export function useRegionQueue(regionCpu: string, availableQueues: string[] = []) {
  const [selectedQueue, setSelectedQueueState] = useState<string | null>(() =>
    getStoredQueueForRegion(regionCpu, availableQueues),
  );

  // Оновлюємо вибір при зміні області або списку доступних черг
  useEffect(() => {
    const queue = getStoredQueueForRegion(regionCpu, availableQueues);
    setSelectedQueueState(queue);
  }, [regionCpu, availableQueues]);

  const selectQueue = useCallback(
    (queue: string) => {
      setSelectedQueueState(queue);
      setStoredQueueForRegion(regionCpu, queue);
    },
    [regionCpu],
  );

  return {
    selectedQueue,
    selectQueue,
  };
}
