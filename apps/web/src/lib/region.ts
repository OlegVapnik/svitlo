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
  /**
   * На сьогодні оператор опублікував ГПВ, і жодної години відключення в ньому немає.
   *
   * Разом із `slots === 0` це «відключень за графіком немає», а не «даних немає»: у такої області
   * в БД нуль слотів, бо зберігати нічого. Без цього поля UI писав «Немає даних» там, де оператор
   * графік опублікував (див. `shared/src/index.ts`, `RegionSummary.allClear`).
   */
  allClear?: boolean;
  /**
   * `cpu` фіда, під якими лежать дані цієї області (див. shared/regions-catalog.ts). Саме ці коди
   * треба передавати в `?region=`: каталог показує канонічну назву, а графік зберігається під ключем
   * фіда (`kyivska-oblast` → `kiivska-oblast`, `kyiv-city` → `kyiv`).
   */
  feedKeys?: string[];
  /**
   * Область — мережа всередині іншої області (`dnipro-cek` у «Дніпропетровській області»).
   *
   * ЦЕК і ДнЕМ мають однакову нумерацію черг, але це різні мережі, тому UI показує їх вибором
   * мережі під областю, а не двома окремими областями з однаковою назвою міста.
   */
  parentCpu?: string;
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

/** Що показувати в бейджі області. */
export type RegionDataBadge = 'slots' | 'allClear' | 'noData';

/**
 * Стан області для бейджа: є слоти → «N слотів»; ГПВ опубліковано без відключень → «світло за
 * графіком»; інакше — «немає даних». Остання гілка означає саме «не знаємо»: оператор на сьогодні
 * нічого не публікував або фід про цю область мовчить.
 *
 * Слоти мають пріоритет над `allClear`: якщо в БД є години відключень, показуємо саме їх (у такому
 * разі `allClear` з бекенду = false, але й порядок гілок робить це явним).
 */
export function regionDataBadge(region: Pick<RegionSummary, 'slots' | 'allClear'>): RegionDataBadge {
  if ((region.slots ?? 0) > 0) return 'slots';
  return region.allClear === true ? 'allClear' : 'noData';
}

/** Рядок списку вибору області: сама область, група областей або мережа всередині групи. */
export interface RegionOption {
  region: RegionSummary;
  /** 0 — область або група; 1 — мережа всередині групи (у списку з відступом). */
  depth: 0 | 1;
  /**
   * Група не обирається: це «Дніпропетровська область», за якою стоять дві різні мережі
   * (`dnipro-cek`, `dnipro-dnem`). Графік по «області цілком» не існує, тому вибір робить людина.
   */
  isGroup: boolean;
}

/**
 * Перетворює каталог областей у рядки списку з підпорядкуванням.
 *
 * Навіщо: бекенд повертає область, яку фід віддає кількома мережами, як групу з підобластями
 * (`feedKeys.length > 1`, а підобласті мають `parentCpu`). Показати їх двома окремими областями
 * («м. Дніпро (ЦЕК)» і «м. Дніпро (ДнЕМ)») означало б двічі спитати одне й те саме; показати одну
 * «Дніпропетровську область» — віддати чужий графік. Тому група — заголовок, а мережі — вибір.
 */
export function regionOptions(regions: RegionSummary[]): RegionOption[] {
  const byCpu = new Set(regions.map((region) => region.cpu));
  // Дитиною вважаємо лише ту область, чий батько реально є в списку: інакше вона просто зникала б
  // зі списку (наприклад, коли каталог прийшов обрізаний або зі старого кеша).
  const children = new Map<string, RegionSummary[]>();
  for (const region of regions) {
    if (!region.parentCpu || !byCpu.has(region.parentCpu)) continue;
    const list = children.get(region.parentCpu) ?? [];
    list.push(region);
    children.set(region.parentCpu, list);
  }
  const options: RegionOption[] = [];
  for (const region of regions) {
    if (region.parentCpu && byCpu.has(region.parentCpu)) continue; // дитина виводиться під батьком
    const isGroup = !region.parentCpu && (region.feedKeys?.length ?? 0) > 1;
    options.push({ region, depth: 0, isGroup });
    // Мережі виводимо лише тоді, коли вони реально прийшли в каталозі: якщо їх немає, група
    // лишається порожнім заголовком без вибору — і це чесніше, ніж вигадати мережу.
    for (const child of children.get(region.cpu) ?? []) {
      options.push({ region: child, depth: 1, isGroup: false });
    }
  }
  return options;
}

/**
 * Фільтр за пошуковим рядком: назва українською, англійська назва, `cpu` або назва мережі.
 *
 * Ключове: коли збігся ЛИШЕ дочірній рядок мережі, батьківська група лишається в списку — інакше
 * пошук «Дніпро» показав би мережу без області, і людина не зрозуміла б, до чого вона належить.
 * Коли збіглася область, її мережі теж лишаються видимими.
 */
export function filterRegions(regions: RegionSummary[], query: string): RegionSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return regions;
  const matches = (region: RegionSummary): boolean =>
    region.nameUa.toLowerCase().includes(needle) ||
    (region.nameEn ? region.nameEn.toLowerCase().includes(needle) : false) ||
    region.cpu.toLowerCase().includes(needle);

  const keep = new Set<string>();
  for (const region of regions) {
    if (!matches(region)) continue;
    keep.add(region.cpu);
    // Мережа знайшлася — лишаємо її область, інакше мережа «висить» без батька.
    if (region.parentCpu) keep.add(region.parentCpu);
  }
  // Область знайшлася — показуємо і її мережі, щоб було з чого вибирати.
  for (const region of regions) {
    if (region.parentCpu && keep.has(region.parentCpu)) keep.add(region.cpu);
  }
  return regions.filter((region) => keep.has(region.cpu));
}
