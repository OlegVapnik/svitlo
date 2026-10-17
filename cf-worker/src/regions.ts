/**
 * Каталог областей для Cloudflare Worker.
 *
 * Источник правды — `packages/shared/src/regions-catalog.ts`. Воркер собирается wrangler'ом
 * отдельно от монорепо и намеренно не тянет `@svitlo/shared` (тот везёт за собой zod), поэтому
 * каталог здесь продублирован. При изменении каталога обновлять ОБА файла.
 *
 * Зачем каталог нужен воркеру: человек ищет «Київська область», «Київ», «Дніпропетровська
 * область», а данные зеркала лежат под `kiivska-oblast`, `kyiv` и двумя ключами м. Дніпро
 * (`dnipro-cek` — ЦЕК, `dnipro-dnem` — ДнЕМ). Порожний `feedKeys` — область, которую фид не
 * отдаёт вовсе: она остаётся в каталоге с нулями, чтобы человек нашёл её и увидел честное
 * «даних немає».
 */

export interface RegionCatalogEntry {
  /** Канонический `cpu` области — то, что видит человек в `/api/v1/regions`. */
  cpu: string;
  /** Украинская подпись для интерфейса. */
  nameUa: string;
  /** `cpu` фида, под которыми лежат данные области; пусто — фид её не отдаёт. */
  feedKeys: string[];
}

/** Каталог: 24 области + Киев. */
export const REGION_CATALOG: RegionCatalogEntry[] = [
  { cpu: 'vinnytska-oblast', nameUa: 'Вінницька область', feedKeys: [] },
  { cpu: 'volynska-oblast', nameUa: 'Волинська область', feedKeys: [] },
  {
    cpu: 'dnipropetrovska-oblast',
    nameUa: 'Дніпропетровська область',
    feedKeys: ['dnipro-cek', 'dnipro-dnem'],
  },
  { cpu: 'donetska-oblast', nameUa: 'Донецька область', feedKeys: [] },
  { cpu: 'zhytomyrska-oblast', nameUa: 'Житомирська область', feedKeys: ['zhytomyrska-oblast'] },
  { cpu: 'zakarpatska-oblast', nameUa: 'Закарпатська область', feedKeys: ['zakarpatska-oblast'] },
  { cpu: 'zaporizka-oblast', nameUa: 'Запорізька область', feedKeys: ['zaporizka-oblast'] },
  {
    cpu: 'ivano-frankivska-oblast',
    nameUa: 'Івано-Франківська область',
    feedKeys: ['ivano-frankivska-oblast'],
  },
  { cpu: 'kyiv-city', nameUa: 'Київ', feedKeys: ['kyiv'] },
  { cpu: 'kyivska-oblast', nameUa: 'Київська область', feedKeys: ['kiivska-oblast'] },
  { cpu: 'kirovohradska-oblast', nameUa: 'Кіровоградська область', feedKeys: [] },
  { cpu: 'luhanska-oblast', nameUa: 'Луганська область', feedKeys: [] },
  { cpu: 'lvivska-oblast', nameUa: 'Львівська область', feedKeys: ['lvivska-oblast'] },
  { cpu: 'mykolaivska-oblast', nameUa: 'Миколаївська область', feedKeys: [] },
  { cpu: 'odeska-oblast', nameUa: 'Одеська область', feedKeys: [] },
  { cpu: 'poltavska-oblast', nameUa: 'Полтавська область', feedKeys: ['poltavska-oblast'] },
  { cpu: 'rivnenska-oblast', nameUa: 'Рівненська область', feedKeys: ['rivnenska-oblast'] },
  { cpu: 'sumska-oblast', nameUa: 'Сумська область', feedKeys: [] },
  { cpu: 'ternopilska-oblast', nameUa: 'Тернопільська область', feedKeys: ['ternopilska-oblast'] },
  { cpu: 'kharkivska-oblast', nameUa: 'Харківська область', feedKeys: ['kharkivska-oblast'] },
  { cpu: 'khersonska-oblast', nameUa: 'Херсонська область', feedKeys: [] },
  { cpu: 'khmelnytska-oblast', nameUa: 'Хмельницька область', feedKeys: ['khmelnytska-oblast'] },
  { cpu: 'cherkaska-oblast', nameUa: 'Черкаська область', feedKeys: ['cherkaska-oblast'] },
  { cpu: 'chernivetska-oblast', nameUa: 'Чернівецька область', feedKeys: [] },
  { cpu: 'chernihivska-oblast', nameUa: 'Чернігівська область', feedKeys: ['chernihivska-oblast'] },
];

/** Подписи ключей фида, у которых нет своей области (Киев, Киевская область, сети Днепра). */
export const REGION_FEED_NAMES: Record<string, string> = {
  kyiv: 'Київ',
  'kiivska-oblast': 'Київська область',
  'dnipro-cek': 'м. Дніпро (ЦЕК)',
  'dnipro-dnem': 'м. Дніпро (ДнЕМ)',
};

/** Опечатки из старых закладок и ссылок: «dnipropetrovnska» (без «е»). */
export const REGION_ALIASES: Record<string, string> = {
  'dnipropetrovnska-oblast': 'dnipropetrovska-oblast',
};

const CATALOG_BY_CPU = new Map(REGION_CATALOG.map((entry) => [entry.cpu, entry]));

/** Ключ фида → канонический `cpu`: без этого `kyiv` не находил `kyiv-city`. */
const CANONICAL_BY_FEED_KEY = new Map<string, string>();
for (const entry of REGION_CATALOG) {
  for (const feedKey of entry.feedKeys) {
    if (feedKey !== entry.cpu) CANONICAL_BY_FEED_KEY.set(feedKey, entry.cpu);
  }
}

/** Все ключи фида, какие вообще бывают: по ним отличаем «сеть» от «области». */
export const FEED_KEYS = new Set<string>(REGION_CATALOG.flatMap((entry) => entry.feedKeys));

export function regionCatalogName(cpu: string): string | null {
  return CATALOG_BY_CPU.get(cpu)?.nameUa ?? null;
}

/** Канонический `cpu` для того, что пришло снаружи: ключ фида, псевдоним или уже канонический. */
export function canonicalRegionCpu(cpu: string): string {
  const value = cpu.trim();
  if (CATALOG_BY_CPU.has(value)) return value;
  const alias = REGION_ALIASES[value];
  if (alias) return alias;
  return CANONICAL_BY_FEED_KEY.get(value) ?? value;
}

/**
 * Ключи фида, под которыми лежат данные области.
 *
 * Пустой массив — область известна, но фид её не отдаёт; неизвестный `cpu` возвращаем как «свой
 * единственный ключ»: так запрос к нему остаётся честно пустым графиком, а не путается с чужой
 * областью.
 */
export function regionFeedKeys(cpu: string): string[] {
  const canonical = canonicalRegionCpu(cpu);
  const entry = CATALOG_BY_CPU.get(canonical);
  if (entry) return [...entry.feedKeys];
  return [canonical];
}

/** Область с несколькими сетями: её график нельзя сливать в один (у ЦЕК и ДнЕМ разные группы). */
export function isGroupedRegion(cpu: string): boolean {
  return regionFeedKeys(cpu).length > 1;
}

/** Ключи чтения запроса: явно названная сеть читается только по себе, область — по всем ключам. */
export function regionReadKeys(cpu: string): string[] {
  const value = cpu.trim();
  const canonical = canonicalRegionCpu(value);
  const keys = regionFeedKeys(canonical);
  if (keys.includes(value)) return [value];
  return keys.length > 0 ? keys : [canonical];
}

/** Подпись области по ключу фида: своё имя, если зеркало его не прислало. */
export function regionFeedName(cpu: string, feedName?: string | null): string {
  const clean = feedName?.trim();
  if (clean) return clean;
  return REGION_FEED_NAMES[cpu] ?? cpu;
}

/** Названия областей для подписи в интерфейсе. */
export const REGION_NAMES: Record<string, string> = Object.fromEntries(
  REGION_CATALOG.map((entry) => [entry.cpu, entry.nameUa]),
);
// Ключи фида тоже получают подпись, иначе «dnipro-cek» показывался бы слагом.
for (const [key, name] of Object.entries(REGION_FEED_NAMES)) REGION_NAMES[key] = name;
