/**
 * Підтримка мультирегіональності (контракт /tmp/API-CONTRACT-regions.md).
 * Область задається cpu-ідентифікатором (наприклад, 'chernihivska-oblast', 'kyiv-city').
 */

export const DEFAULT_REGION = 'chernihivska-oblast';
export const DEFAULT_REGION_NAME_UA = 'Чернігівська область';
export const REGION_STORAGE_KEY = 'svitlo_region';

export interface RegionSummary {
  cpu: string;
  nameUa: string;
  nameEn: string | null;
  queues: string[];
  slots: number;
  lastDate: string | null;
}

export interface RegionListResponse {
  data: RegionSummary[];
}

const REGION_CPU_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Перевіряє, чи відповідає значення формату cpu області (kebab-case). */
export function isRegionCpu(value: unknown): value is string {
  return typeof value === 'string' && REGION_CPU_REGEX.test(value.trim());
}

/** Нормалізує cpu області (trim, lowercase). */
export function normalizeRegionCpu(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_REGION;
  const clean = value.trim().toLowerCase();
  return isRegionCpu(clean) ? clean : DEFAULT_REGION;
}

/** Читає збережену область із локального сховища або повертає дефолтну. */
export function getStoredRegion(storage?: Pick<Storage, 'getItem'>): string {
  try {
    const raw = storage ? storage.getItem(REGION_STORAGE_KEY) : (typeof localStorage !== 'undefined' ? localStorage.getItem(REGION_STORAGE_KEY) : null);
    return raw && isRegionCpu(raw) ? raw.trim().toLowerCase() : DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}

/** Зберігає обрану область у локальне сховище. */
export function setStoredRegion(cpu: string, storage?: Pick<Storage, 'setItem'>): void {
  const clean = normalizeRegionCpu(cpu);
  try {
    if (storage) {
      storage.setItem(REGION_STORAGE_KEY, clean);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REGION_STORAGE_KEY, clean);
    }
  } catch {
    // ігноруємо помилки квоти або відключеного сховища
  }
}

/** Формує підпис для списку областей: назва + кількість черг (якщо відомо). */
export function formatRegionOption(region: RegionSummary): string {
  const queuesCount = region.queues?.length ?? 0;
  if (queuesCount > 0) {
    return `${region.nameUa} (${queuesCount})`;
  }
  return region.nameUa;
}
