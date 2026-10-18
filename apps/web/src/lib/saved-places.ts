import { isQueueCode, normalizeQueueCode } from './queue.js';
import { isRegionCpu, normalizeRegionCpu } from './region.js';

/**
 * Збережені місця («Дім», «Робота», «Дача») — еволюція закладок.
 *
 * Чому не «закладки»: людина зберігає не групу й не чергу, а МІСЦЕ, де буває: дім, роботу,
 * дачу батьків. Тому в місця є власна назва (до 24 символів) та іконка, а група — лише
 * технічна прив'язка, за якою будується графік.
 *
 * Схема v2 (ключ `svitlo_saved_places`) додала `icon`, `house`, `createdAt` і ліміт назви.
 * Старі закладки (v1, `svitlo_bookmarks`) мігрують автоматично під час першого читання —
 * втратити збережену адресу через оновлення застосунку неприпустимо.
 *
 * Файл навмисно без React і без localStorage у бізнес-функціях: так міграцію, ліміт і
 * дедуплікацію можна перевірити unit-тестами, не піднімаючи браузер.
 */

export const SAVED_PLACES_KEY = 'svitlo_saved_places';
export const LEGACY_BOOKMARKS_KEY = 'svitlo_bookmarks';
export const SAVED_PLACES_SCHEMA_VERSION = 2;

/** Більше десятка чипів на головній — це вже не швидкий перемикач, а список. */
export const MAX_SAVED_PLACES = 10;

/** Назва мусить уміщатися в чип і не ламати рядок: 24 символи — межа, а не побажання. */
export const MAX_PLACE_LABEL_LENGTH = 24;

/**
 * Вісім іконок — достатньо, щоб розрізнити місця з першого погляду, і мало, щоб не
 * перетворювати вибір на бібліотеку іконок.
 */
export const PLACE_ICONS = [
  'home',
  'work',
  'family',
  'dacha',
  'garage',
  'office',
  'school',
  'star',
] as const;

export type PlaceIcon = (typeof PLACE_ICONS)[number];

export interface SavedPlace {
  id: string;
  /** Людська назва: «Дім», «Робота», «Дача». Завжди 1–24 символи. */
  label: string;
  icon: PlaceIcon;
  /** cpu області з каталогу /regions (напр. 'kyiv-city'). Місце несе СВОЮ область. */
  regionCpu: string;
  /** Населений пункт (село/смт/місто), якщо місце — вулиця чи село. */
  settlementName?: string;
  /** Вулиця, якщо місце — конкретна адреса. */
  streetName?: string;
  /** Номер будинку окремо від вулиці: так адреси не схлопуються при дедуплікації. */
  house?: string;
  /** Черга у форматі застосунку ('3', '2/2'). */
  queue: string;
  /** Головне місце — те, що показується в герої на головній. Рівно одне в списку. */
  isPrimary?: boolean;
  /**
   * Адресу підтвердив сам користувач кнопкою «Це моя група». Це не дані оператора, тому
   * в місці окрема помітка: локальне підтвердження не можна видавати за офіційне.
   */
  addressConfirmed?: boolean;
  /** Час створення (мс). Потрібен для стабільного сортування при відновленні після undo. */
  createdAt?: number;
}

export interface StoredSavedPlaces {
  schemaVersion: number;
  places: SavedPlace[];
}

export type AddPlaceInput = {
  label?: string;
  icon?: PlaceIcon;
  regionCpu: string;
  settlementName?: string;
  streetName?: string;
  house?: string;
  queue: string;
  addressConfirmed?: boolean;
  makePrimary?: boolean;
  /** Сумісність із закладками v1: прапор більше не потрібен, дедуплікація йде по адресі. */
  allowDuplicate?: boolean;
};

export type AddPlaceResult =
  | { ok: true; places: SavedPlace[]; place: SavedPlace; duplicate?: SavedPlace }
  | {
      ok: false;
      reason: 'invalid-queue' | 'invalid-region' | 'limit' | 'duplicate';
      places: SavedPlace[];
      duplicate?: SavedPlace;
    };

function makeId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `place-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Нормалізує адресу для порівняння: регістр і зайві пробіли не роблять її іншою. */
function addressKey(
  place: Pick<SavedPlace, 'regionCpu' | 'queue' | 'settlementName' | 'streetName' | 'house'>,
): string {
  const part = (value?: string) => (value ?? '').trim().toLowerCase().replace(/\s+/gu, ' ');
  return [place.regionCpu, part(place.settlementName), part(place.streetName), part(place.house)].join('|');
}

/**
 * Чистить назву місця: прибирає керуючі символи, згортає пробіли, обрізає до 24 символів.
 * Порожній результат означає «назву не ввели» — викликач підставить типову.
 */
export function sanitizePlaceLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_PLACE_LABEL_LENGTH);
}

/** Типова назва для нового місця: перше — «Дім», далі «Адреса 2», «Адреса 3» тощо. */
export function defaultPlaceLabel(places: readonly SavedPlace[]): string {
  if (!places.some((place) => place.label === 'Дім')) return 'Дім';
  for (let index = 2; index <= MAX_SAVED_PLACES + 1; index += 1) {
    const candidate = `Адреса ${index}`;
    if (!places.some((place) => place.label === candidate)) return candidate;
  }
  return `Адреса ${places.length + 1}`;
}

/** Іконка за назвою для міграції старих закладок: «Дім» → будинок, «Робота» → портфель. */
function inferIcon(label: string): PlaceIcon {
  const normalized = label.toLowerCase();
  if (normalized.startsWith('дім') || normalized.startsWith('дом')) return 'home';
  if (normalized.startsWith('робот') || normalized.startsWith('работ')) return 'work';
  return 'star';
}

export function isPlaceIcon(value: unknown): value is PlaceIcon {
  return typeof value === 'string' && (PLACE_ICONS as readonly string[]).includes(value);
}

/**
 * Приводить запис до поточної схеми. Повертає null, якщо запис не рятується: краще втратити
 * один битий елемент, ніж показати порожній чип або зламати весь список.
 */
function normalizePlace(value: unknown): SavedPlace | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;

  const queue = normalizeQueueCode(typeof raw.queue === 'string' ? raw.queue : '');
  if (!isQueueCode(queue)) return null;
  const rawRegion = typeof raw.regionCpu === 'string' ? raw.regionCpu.trim().toLowerCase() : '';
  // Валідуємо ДО normalizeRegionCpu: та на будь-якому смітті повертає область за
  // замовчуванням, і битий запис тихо перетворився б на «Дім у Чернігові».
  if (!isRegionCpu(rawRegion)) return null;
  const regionCpu = normalizeRegionCpu(rawRegion);

  // v1 не мав `kind`, але старі експорти могли його містити — підтримуємо обидва варіанти.
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  const legacyLabel = typeof raw.label === 'string' ? raw.label : '';
  const labelParts = legacyLabel.split('·');
  const shortLabel =
    kind === 'home' ? 'Дім' : kind === 'work' ? 'Робота' : labelParts[0] ?? legacyLabel;

  const label = sanitizePlaceLabel(shortLabel) || sanitizePlaceLabel(legacyLabel) || 'Адреса';
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : makeId();

  return {
    id,
    label,
    icon: isPlaceIcon(raw.icon) ? raw.icon : inferIcon(legacyLabel || label),
    regionCpu,
    settlementName:
      typeof raw.settlementName === 'string' && raw.settlementName.trim()
        ? raw.settlementName.trim()
        : undefined,
    streetName:
      typeof raw.streetName === 'string' && raw.streetName.trim() ? raw.streetName.trim() : undefined,
    house: typeof raw.house === 'string' && raw.house.trim() ? raw.house.trim() : undefined,
    queue,
    isPrimary: raw.isPrimary === true ? true : undefined,
    addressConfirmed: raw.addressConfirmed === true ? true : undefined,
    createdAt:
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  };
}

/** Рівно одне головне місце: якщо жодне не позначене — перше стає головним. */
export function ensurePrimary(places: SavedPlace[]): SavedPlace[] {
  if (places.length === 0) return places;
  const primaryIndex = places.findIndex((place) => place.isPrimary);
  const target = primaryIndex < 0 ? 0 : primaryIndex;
  // Якщо головне вже одне й на своєму місці — не перестворюємо об'єкти даремно:
  // інакше кожен виклик давав би нові посилання і зайвий ререндер.
  const primaryCount = places.filter((place) => place.isPrimary).length;
  if (target === 0 && primaryCount === 1) return places;
  return places.map((place, index) => ({ ...place, isPrimary: index === target }));
}

/**
 * Міграція з будь-якого відомого формату.
 *
 * Приймає і новий конверт `{ schemaVersion: 2, places }`, і старий `{ schemaVersion: 1,
 * bookmarks }`, і голий масив (на випадок ручних правок у DevTools). Дублікати по id та по
 * адресі схлопуються: дві однакові адреси в списку — це два чипи з однаковою поведінкою.
 */
export function migrateSavedPlaces(raw: unknown): SavedPlace[] {
  if (raw === null || raw === undefined) return [];

  const container = raw as Record<string, unknown> | unknown[];
  const list = Array.isArray(container)
    ? container
    : Array.isArray((container as Record<string, unknown>).places)
      ? ((container as Record<string, unknown>).places as unknown[])
      : Array.isArray((container as Record<string, unknown>).bookmarks)
        ? ((container as Record<string, unknown>).bookmarks as unknown[])
        : [];

  const seenIds = new Set<string>();
  const seenAddresses = new Set<string>();
  const places: SavedPlace[] = [];

  for (const item of list) {
    const place = normalizePlace(item);
    if (!place) continue;
    if (seenIds.has(place.id)) continue;
    const key = addressKey(place);
    if (seenAddresses.has(key)) continue;
    seenIds.add(place.id);
    seenAddresses.add(key);
    places.push(place);
    if (places.length >= MAX_SAVED_PLACES) break;
  }

  return ensurePrimary(places);
}

/**
 * Додає місце. Дублікат (та сама область, черга й адреса) не створюється: повертаємо
 * існуюче місце з `duplicate`, щоб інтерфейс запропонував «Відкрити» замість мовчазного
 * другого чипа.
 */
export function addSavedPlace(places: readonly SavedPlace[], input: AddPlaceInput): AddPlaceResult {
  const queue = normalizeQueueCode(input.queue);
  if (!isQueueCode(queue)) return { ok: false, reason: 'invalid-queue', places: [...places] };
  const rawRegion = input.regionCpu.trim().toLowerCase();
  if (!isRegionCpu(rawRegion)) return { ok: false, reason: 'invalid-region', places: [...places] };
  const regionCpu = normalizeRegionCpu(rawRegion);

  const candidate: SavedPlace = {
    id: makeId(),
    label: sanitizePlaceLabel(input.label) || defaultPlaceLabel(places),
    icon: input.icon ?? 'star',
    regionCpu,
    settlementName: input.settlementName?.trim() || undefined,
    streetName: input.streetName?.trim() || undefined,
    house: input.house?.trim() || undefined,
    queue,
    addressConfirmed: input.addressConfirmed ? true : undefined,
    createdAt: Date.now(),
  };

  const key = addressKey(candidate);
  const duplicate = places.find((place) => addressKey(place) === key);
  if (duplicate) {
    return { ok: false, reason: 'duplicate', places: [...places], duplicate };
  }
  if (places.length >= MAX_SAVED_PLACES) {
    return { ok: false, reason: 'limit', places: [...places] };
  }

  const next = [...places, candidate];
  const withPrimary = input.makePrimary
    ? next.map((place) => ({ ...place, isPrimary: place.id === candidate.id }))
    : ensurePrimary(next);
  const saved = withPrimary.find((place) => place.id === candidate.id) ?? candidate;

  return { ok: true, places: withPrimary, place: saved };
}

/** Перейменування: порожня назва не стирає існуючу — просто нічого не змінює. */
export function renameSavedPlace(
  places: readonly SavedPlace[],
  id: string,
  label: string,
): SavedPlace[] {
  const cleanLabel = sanitizePlaceLabel(label);
  if (!cleanLabel) return [...places];
  return places.map((place) => (place.id === id ? { ...place, label: cleanLabel } : place));
}

export function setSavedPlaceIcon(
  places: readonly SavedPlace[],
  id: string,
  icon: PlaceIcon,
): SavedPlace[] {
  if (!isPlaceIcon(icon)) return [...places];
  return places.map((place) => (place.id === id ? { ...place, icon } : place));
}

/** Зміна групи в межах тієї самої адреси: людина побачила, що оператор переніс вулицю. */
export function setSavedPlaceQueue(
  places: readonly SavedPlace[],
  id: string,
  queue: string,
  addressConfirmed = true,
): SavedPlace[] {
  const code = normalizeQueueCode(queue);
  if (!isQueueCode(code)) return [...places];
  return places.map((place) =>
    place.id === id
      ? { ...place, queue: code, addressConfirmed: addressConfirmed ? true : undefined }
      : place,
  );
}

export function setSavedPlacePrimary(places: readonly SavedPlace[], id: string): SavedPlace[] {
  if (!places.some((place) => place.id === id)) return [...places];
  return places.map((place) => ({ ...place, isPrimary: place.id === id }));
}

/** Видалення: якщо зникло головне місце — головним стає перше з решти. */
export function removeSavedPlace(places: readonly SavedPlace[], id: string): SavedPlace[] {
  return ensurePrimary(places.filter((place) => place.id !== id));
}

/**
 * Переміщення місця вгору/вниз. Порядок — це не косметика: перші чотири чипи на головній
 * видно без прокрутки, тому людина сама вирішує, що там стоїть.
 */
export function moveSavedPlace(
  places: readonly SavedPlace[],
  id: string,
  direction: -1 | 1,
): SavedPlace[] {
  const index = places.findIndex((place) => place.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= places.length) return [...places];
  const next = [...places];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Відновлення після undo: місце повертається на свою позицію, а не в кінець списку. */
export function restoreSavedPlace(
  places: readonly SavedPlace[],
  place: SavedPlace,
  index: number,
): SavedPlace[] {
  if (places.some((item) => item.id === place.id)) return [...places];
  if (places.length >= MAX_SAVED_PLACES) return [...places];
  const next = [...places];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, place);
  return ensurePrimary(next);
}

/** Місце, яке відповідає поточній області й черзі (для підсвічування чипа). */
export function findSavedPlaceFor(
  places: readonly SavedPlace[],
  regionCpu: string,
  queue: string,
): SavedPlace | null {
  return places.find((place) => place.regionCpu === regionCpu && place.queue === queue) ?? null;
}

/** Читає сирий вміст localStorage для нового ключа, з відкатом на старий. */
export function readRawSavedPlaces(storage: Pick<Storage, 'getItem'>): {
  raw: unknown;
  migrated: boolean;
} {
  try {
    const current = storage.getItem(SAVED_PLACES_KEY);
    if (current) {
      const parsed = JSON.parse(current) as StoredSavedPlaces;
      return {
        raw: Array.isArray(parsed.places) ? parsed.places : [],
        migrated: parsed.schemaVersion !== SAVED_PLACES_SCHEMA_VERSION,
      };
    }
    const legacy = storage.getItem(LEGACY_BOOKMARKS_KEY);
    if (legacy) return { raw: JSON.parse(legacy) as unknown, migrated: true };
  } catch {
    // Битий JSON не повинен валити старт застосунку.
  }
  return { raw: [], migrated: false };
}

/** Серіалізує список у конверт поточної схеми. */
export function serializeSavedPlaces(places: readonly SavedPlace[]): string {
  const payload: StoredSavedPlaces = {
    schemaVersion: SAVED_PLACES_SCHEMA_VERSION,
    places: [...places],
  };
  return JSON.stringify(payload);
}

