export {
  configureCoreApi,
  getApiBaseUrl,
  getCoreConfig,
  type CoreConfig,
} from './config';
export {
  configureStorage,
  createMemoryStorage,
  getStorage,
  storage,
  type KeyValueStorage,
} from './storage';
export { configureAddressPacks, getAddressPacksBaseUrl } from './api/address-packs';
export * from './lib/saved-places';
export * from './lib/saved-places-store';
export * from './lib/calendar-link';

export { readRegionScheduleSnapshot } from './api/offline-region-schedules';
export {
  getGridRegime,
  getGridRegimeRegion,
  resetGridRegime,
  setGridRegime,
  subscribeGridRegime,
} from './api/grid-regime-store';
// Правило видимості банера живе в домені: воно не залежить від платформи й перевіряється
// тими самими тестами, що й класифікатор режимів.
export { gridRegimeAppliesToQueue, visibleGridRegime } from '@svitlo/domain';
export { queryClient } from "./api/query-client";
export { QueryClientProvider, useQueries } from "@tanstack/react-query";
