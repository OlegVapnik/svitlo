/**
 * Канонічний каталог областей України та псевдоніми (`cpu`) дзеркала ГПВ.
 *
 * Навіщо окремий модуль: у фіді, у довідниках і в коді жили РІЗНІ назви однієї області.
 * Дзеркало віддає `kiivska-oblast` (Київська область), `kyiv` (Київ) і два окремі ключі
 * `dnipro-cek` / `dnipro-dnem` для м. Дніпро (ЦЕК і ДнЕМ — різні оператори розподільчих мереж).
 * Людина ж шукає «Дніпропетровська область» або «Київська область» — і не знаходила: у каталозі
 * був ключ оператора, або область показувала `slots: 0`, бо дані лежали під іншим `cpu`.
 *
 * Правила тут навмисно прості, бо від них залежить, чи не змішаємо ми два різні графіки:
 *  1. `feedKeys` — тільки ключі фіда. Це єдині `cpu`, під якими реально лежать слоти
 *     (`schedule_slots.region`), тому запити даних завжди звужуються до них.
 *  2. Область із ОДНИМ ключем (Київська, Київ) підставляється прозоро: `kyivska-oblast` →
 *     `kiivska-oblast`. Нічого не втрачається, підміна безпечна.
 *  3. Область із КІЛЬКОМА ключами (`dnipropetrovska-oblast` → ЦЕК + ДнЕМ) не можна «злити» в один
 *     графік: черга «2/2» у ЦЕК і «2/2» у ДнЕМ — різні фізичні групи, об'єднання інтервалів дало б
 *     години відключень, яких у людини немає (і навпаки). Тому каталог показує таку область як
 *     групу з підобластями, а запит графіка вимагає конкретний ключ (див. `regionFeedKeys`).
 *  4. Області, яких фід не віддає взагалі (Одеса, Суми, Вінниця…), у каталозі Є, але з порожнім
 *     `feedKeys`: людина знаходить свою область і бачить чесне «даних немає», а не порожній список
 *     без неї. Псевдонімів, які «щось» вигадують, тут немає.
 */
export interface RegionCatalogEntry {
  /** Канонічний `cpu` області — те, що бачить людина в каталозі `/api/v1/regions`. */
  cpu: string;
  /** Українська назва для інтерфейсу. */
  nameUa: string;
  /** `cpu` фіда, під якими лежать дані області; порожньо — фід її не віддає. */
  feedKeys: string[];
}

/**
 * Каталог: 24 області + Київ. `feedKeys` — те, що справді віддає дзеркало (перевірено запитом
 * до `MIRROR_SCHEDULE_URL`: 16 ключів, серед них `kiivska-oblast`, `kyiv`, `dnipro-cek`, `dnipro-dnem`).
 */
export const REGION_CATALOG: RegionCatalogEntry[] = [
  { cpu: 'vinnytska-oblast', nameUa: 'Вінницька область', feedKeys: [] },
  { cpu: 'volynska-oblast', nameUa: 'Волинська область', feedKeys: [] },
  { cpu: 'dnipropetrovska-oblast', nameUa: 'Дніпропетровська область', feedKeys: ['dnipro-cek', 'dnipro-dnem'] },
  { cpu: 'donetska-oblast', nameUa: 'Донецька область', feedKeys: [] },
  { cpu: 'zhytomyrska-oblast', nameUa: 'Житомирська область', feedKeys: ['zhytomyrska-oblast'] },
  { cpu: 'zakarpatska-oblast', nameUa: 'Закарпатська область', feedKeys: ['zakarpatska-oblast'] },
  { cpu: 'zaporizka-oblast', nameUa: 'Запорізька область', feedKeys: ['zaporizka-oblast'] },
  { cpu: 'ivano-frankivska-oblast', nameUa: 'Івано-Франківська область', feedKeys: ['ivano-frankivska-oblast'] },
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

/**
 * Назви ключів фіда, які НЕ дорівнюють канонічному `cpu`. Потрібні як підпис підобласті, коли
 * фід (холодний кеш) назви не віддав, або коли треба показати, який оператор стоїть за областю.
 */
export const REGION_FEED_NAMES: Record<string, string> = {
  kyiv: 'Київ',
  'kiivska-oblast': 'Київська область',
  'dnipro-cek': 'м. Дніпро (ЦЕК)',
  'dnipro-dnem': 'м. Дніпро (ДнЕМ)',
};

/**
 * Додаткові псевдоніми (як у коді чи документації) → канонічний `cpu`.
 *
 * `dnipropetrovnska-oblast` — не помилка в мапі, а закомічена колись друкарська форма
 * (`parsers/ukraine-providers.adapter.ts`), яку вже могли зберегти клієнти та закладки.
 * Приводимо її до правильної, а не лишаємо «ще одну область, якої немає».
 */
export const REGION_ALIASES: Record<string, string> = {
  'dnipropetrovnska-oblast': 'dnipropetrovska-oblast',
};

const CATALOG_BY_CPU = new Map(REGION_CATALOG.map((entry) => [entry.cpu, entry]));

/** Ключ фіда → канонічний `cpu` (для ключів, які самі не є канонічними). */
const CANONICAL_BY_FEED_KEY = new Map<string, string>();
for (const entry of REGION_CATALOG) {
  for (const feedKey of entry.feedKeys) {
    if (feedKey !== entry.cpu) CANONICAL_BY_FEED_KEY.set(feedKey, entry.cpu);
  }
}

/** Чи це `cpu` з каталогу областей (канонічний), а не ключ фіда. */
export function isRegionCatalogCpu(cpu: string): boolean {
  return CATALOG_BY_CPU.has(cpu);
}

/** Людська назва канонічної області; `null` — такого `cpu` у каталозі немає. */
export function regionCatalogName(cpu: string): string | null {
  return CATALOG_BY_CPU.get(cpu)?.nameUa ?? null;
}

/**
 * Канонічний `cpu` для будь-чого, що прийшло ззовні: ключ фіда, псевдонім або вже канонічний `cpu`.
 * Невідоме значення повертається як є — вигадувати область замість чужого ключа не можна
 * (він може бути справжнім ключем фіда, який ми просто ще не бачили).
 */
export function canonicalRegionCpu(cpu: string): string {
  const value = cpu.trim();
  if (CATALOG_BY_CPU.has(value)) return value;
  const alias = REGION_ALIASES[value];
  if (alias) return alias;
  return CANONICAL_BY_FEED_KEY.get(value) ?? value;
}

/**
 * Ключі фіда, під якими реально лежать дані області. Порожній масив — область відома, але фід
 * її не віддає; невідомий `cpu` повертаємо як «один власний ключ»: так запит до нього лишається
 * чесним порожнім графіком, як і до псевдоніма, про який ми нічого не знаємо.
 */
export function regionFeedKeys(cpu: string): string[] {
  const canonical = canonicalRegionCpu(cpu);
  const entry = CATALOG_BY_CPU.get(canonical);
  if (entry) return [...entry.feedKeys];
  return [canonical];
}

/**
 * Чи це область, яку фід віддає КІЛЬКОМА ключами (м. Дніпро: ЦЕК і ДнЕМ).
 *
 * Для таких областей запит графіка без конкретного ключа не має однозначної відповіді, і мовчазне
 * злиття двох мереж було б вигадкою. Каталог віддає їх як групу з підобластями, а читання даних
 * вимагає конкретний `cpu` (див. `regionFeedKeys`).
 */
export function isGroupedRegion(cpu: string): boolean {
  return regionFeedKeys(cpu).length > 1;
}

/**
 * Ключі фіда для ЧИТАННЯ даних за введеним `cpu`.
 *
 * Відмінність від `regionFeedKeys` одна, але важлива: якщо людина вказала сам ключ фіда
 * (`dnipro-cek`), це вже конкретна мережа — жодного «уточнення» області не потрібно, і питання
 * «ЦЕК чи ДнЕМ?» перед нею не стоїть взагалі. Розширення до всіх мереж області відбувається
 * лише тоді, коли названо область цілком (`dnipropetrovska-oblast`).
 */
export function regionReadKeys(cpu: string): string[] {
  const value = cpu.trim();
  const canonical = canonicalRegionCpu(value);
  const keys = regionFeedKeys(canonical);
  // Вказали сам ключ фіда (`dnipro-cek`, `kyiv`, `kiivska-oblast`) — це вже конкретна мережа.
  if (keys.includes(value)) return [value];
  return keys.length > 0 ? keys : [canonical];
}

/** Назва підобласті (ключа фіда) для каталогу: з фіда або з вбудованої мапи, інакше сам ключ. */
export function regionFeedName(cpu: string, feedName?: string | null): string {
  const clean = feedName?.trim();
  if (clean) return clean;
  return REGION_FEED_NAMES[cpu] ?? cpu;
}
