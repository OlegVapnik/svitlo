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
  /**
   * Слоты только на сегодня и завтра (см. `@svitlo/shared`). `slots` — вся история, поэтому бейдж
   * «N сл.» по нему врал: у Закарпатской области 6 слотов лежали с 1 июля, а графика на сегодня нет.
   */
  todaySlots?: number;
  lastDate: string | null;
  /**
   * На сьогодні оператор опублікував ГПВ, і жодної години відключення в ньому немає.
   *
   * Разом із `slots === 0` це «відключень за графіком немає», а не «даних немає»: у такої області
   * в БД нуль слотів, бо зберігати нічого. Без цього поля UI писав «Немає даних» там, де оператор
   * графік опублікував (див. `shared/src/index.ts`, `RegionSummary.allClear`).
   */
  allClear?: boolean;
  /** Оператор опубликовал график на сегодня. Единственный честный признак «живых» данных:
   * без него весь список полон «Немає даних», и человек листал мимо них до своей области. */
  covered?: boolean;
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

/**
 * Старые коды областей → канонические `cpu`.
 *
 * Зачем: каталог раньше отдавал ключи фида (`kyiv`, `kiivska-oblast`), и эти коды остались у людей
 * в `localStorage`, закладках и ссылках. После перехода на канонические `cpu` поиск строки каталога
 * по старому коду не находил ничего: главная показывала пустой список групп («Черга:» без кнопок) и
 * «Даних графіка немає». Таблица — копия правил `@svitlo/shared` (`canonicalRegionCpu`), но без
 * импорта пакета: он тянет zod в веб-бандл ради двух строк. Тест `region.test.ts` сверяет оба списка.
 */
const LEGACY_REGION_ALIASES: Record<string, string> = {
  kyiv: 'kyiv-city',
  'kiivska-oblast': 'kyivska-oblast',
  'dnipropetrovnska-oblast': 'dnipropetrovska-oblast',
};

/** Перевіряє, чи відповідає значення формату cpu області (kebab-case). */
export function isRegionCpu(value: unknown): value is string {
  return typeof value === 'string' && REGION_CPU_REGEX.test(value.trim());
}

/**
 * Нормалізує cpu області (trim, lowercase) і мігрує старі коди до канонічних.
 *
 * Міграція безпечна: `kyiv` і `kyiv-city` — одна й та сама область (дані фіда просто лежать під
 * `kyiv`), а сервер читає обидва коди (`resolveDbRegions` у воркері, `regionReadKeys` у Node API).
 */
export function normalizeRegionCpu(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_REGION;
  const clean = value.trim().toLowerCase();
  if (!isRegionCpu(clean)) return DEFAULT_REGION;
  return LEGACY_REGION_ALIASES[clean] ?? clean;
}

/** Читає збережену область із локального сховища або повертає дефолтну. */
export function getStoredRegion(
  storage?: Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>,
): string {
  try {
    const raw = storage ? storage.getItem(REGION_STORAGE_KEY) : (typeof localStorage !== 'undefined' ? localStorage.getItem(REGION_STORAGE_KEY) : null);
    const clean = raw && isRegionCpu(raw) ? normalizeRegionCpu(raw) : DEFAULT_REGION;
    // Мигрированный код ЗАПИСУВАЕМ: иначе старый ключ возвращался бы из хранилища при каждом старте.
    // `setItem` не обязателен (в тестах передают заглушку только для чтения) — тогда просто читаем.
    if (raw && clean !== raw.trim().toLowerCase()) {
      const write = storage?.setItem?.bind(storage);
      if (write) write(REGION_STORAGE_KEY, clean);
      else if (!storage && typeof localStorage !== 'undefined') localStorage.setItem(REGION_STORAGE_KEY, clean);
    }
    return clean;
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
/**
 * Подпись области в выпадающем списке.
 *
 * Области без данных помечаем прямо в тексте. Нативный `<select>` не даёт надёжно стилизовать
 * отдельные options (браузеры трактуют class у option по-разному), а слово «немає даних»
 * читается везде и сразу снимает вопрос «почему у меня пусто».
 *
 * Считать колонки групп при этом бессмысленно: у Львова в каталоге 12 групп, но графика от
 * зеркала нет — человек видел бы «Львівська область (12)» и ждал данных, которых не будет.
 */
export function formatRegionOption(region: RegionSummary): string {
  const badge = regionDataBadge(region);
  const queuesCount = region.queues?.length ?? 0;

  if (badge === 'noData') {
    return `${region.nameUa} — ${regionOptionNoDataSuffix}`;
  }
  if (queuesCount > 0) {
    return `${region.nameUa} (${queuesCount})`;
  }
  return region.nameUa;
}

/**
 * Суффикс «данных нет». Константой, а не строкой в f-шаблоне: подпись используется в двух
 * местах, и разъехавшийся текст «Немає даних» и «данных нет» человек заметит сразу.
 */
export const regionOptionNoDataSuffix = 'немає даних';

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
export function regionDataBadge(region: Pick<RegionSummary, 'slots' | 'todaySlots' | 'allClear'>): RegionDataBadge {
  // Считаем слоты на сегодня и завтра, а не всю историю: иначе «6 сл.» от 1 июля убеждали человека,
  // что график на сегодня загружен. Старый кеш без `todaySlots` — падаем назад на `slots`.
  const relevant = region.todaySlots ?? region.slots ?? 0;
  if (relevant > 0) return 'slots';
  return region.allClear === true ? 'allClear' : 'noData';
}

/** Сколько слотов показывать в бейдже области (только актуальные сутки). */
export function regionSlotsForBadge(region: Pick<RegionSummary, 'slots' | 'todaySlots'>): number {
  return region.todaySlots ?? region.slots ?? 0;
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

/**
 * Области с живыми данными — в начало списка.
 *
 * Раньше порядок был исключительно алфавитным, и человек каждое утро прокручивал мимо
 * «Немає даних» у Вінницької и Волинской, чтобы дойти до своей области с графиком. Мёртвые
 * регионы уходят вниз, внутри каждой группы порядок алфавитный — иначе список «прыгал» бы
 * при первом же обновлении данных.
 */
export function sortRegionsByDataFreshness(regions: RegionSummary[]): RegionSummary[] {
  const rank = (region: RegionSummary): number => {
    if (region.covered) return 0;
    // Мережа (ЦЕК/ДнЕМ) наследует свежесть родителя: она в списке рядом с ним, и «живая»
    // область с пустой сетью выглядела бы мёртвой только из-за одной подсети.
    if (region.parentCpu) return 1;
    return 2;
  };
  return [...regions].sort(
    (a, b) => rank(a) - rank(b) || a.nameUa.localeCompare(b.nameUa, 'uk'),
  );
}
