import { useCallback, useEffect, useMemo, useState } from 'react';

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
 *
 * В отличие от веба, вкладки мобильного не размонтируются при переходе. Без общей подписки выбор
 * группы в «Моніторі» не доходил бы до уже смонтированной «Головної»: её состояние осталось бы
 * прежним до перезапуска. Поэтому все экземпляры хука слушают одно событие и перечитывают выбор.
 */
type QueueSelectionListener = () => void;

const listeners = new Set<QueueSelectionListener>();

function notifyQueueSelection(): void {
  for (const listener of listeners) listener();
}

export function useRegionQueue(regionCpu: string, availableQueues: string[] = []) {
  // Список групп приходит из рендера массивом; без стабилизации эффект переподписывался бы
  // на каждом кадре и дёргал соседние экраны.
  const queuesKey = useMemo(() => availableQueues.join('|'), [availableQueues]);
  const stableQueues = useMemo(() => (queuesKey ? queuesKey.split('|') : []), [queuesKey]);

  const [selectedQueue, setSelectedQueueState] = useState<string | null>(() =>
    getStoredQueueForRegion(regionCpu, stableQueues),
  );

  useEffect(() => {
    const sync = () => {
      setSelectedQueueState(getStoredQueueForRegion(regionCpu, stableQueues));
    };
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [regionCpu, stableQueues]);

  const selectQueue = useCallback(
    (queue: string) => {
      setSelectedQueueState(queue);
      setStoredQueueForRegion(regionCpu, queue);
      notifyQueueSelection();
    },
    [regionCpu],
  );

  return { selectedQueue, selectQueue };
}
