import { useSyncExternalStore } from 'react';

import { getGridRegime, subscribeGridRegime } from '@svitlo/core';

/**
 * Режим мережі з офлайн-пакета: те саме джерело, що і на вебі.
 *
 * `useSyncExternalStore`, а не React Query: значення приходить разом із `/sync` і лежить у
 * модулі `@svitlo/core`, тож фонова синхронізація оновлює банер без окремого запиту.
 */
export function useGridRegime() {
  return useSyncExternalStore(subscribeGridRegime, getGridRegime, getGridRegime);
}
