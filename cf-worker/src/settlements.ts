/**
 * Статический справочник населённых пунктов Украины: мгновенный поиск по префиксу.
 *
 * Зачем он нужен рядом с Nominatim. Nominatim требует ПОЛНОЕ слово — на «Черніг» он не
 * находит «Чернігів», а это ровно то, что набирает человек в поле. Плюс каждый запрос к нему
 * уходит в сеть и ждёт ответа. Поэтому города и центры громад лежат в бандле один раз и ищутся
 * в памяти, а Nominatim остаётся только для хуторов и улиц, которых в справочнике нет.
 *
 * Данные — реальные, из официального дампа GeoNames (генерируется tools/gen-settlements-ua.py):
 * областные центры (PPLA/PPLC), центры 2-го и 3-го уровня (PPLA2/PPLA3, то есть нынешние
 * громады) и все места с населением свыше 5000. Ничего не выдумано и не дополнено вручную.
 *
 * Поиск — бинарный по отсортированному массиву: список уже отсортирован нормализованными
 * именами, поэтому «Черн», «Біл» и «Іван» находятся за доли миллисекунды без сети.
 */
import DIRECTORY from './settlements-ua.json';

/** Запись справочника — кортеж [украинское название, код области, широта, долгота]. */
type PlaceEntry = [string, string, number, number];

// JSON импортируется как массив смешанных типов, поэтому приводим через unknown: без
// промежуточного шага TypeScript считает приведение небезопасным.
const PLACES = DIRECTORY.places as unknown as PlaceEntry[];

/** Сопоставление `cpu` региона приложения с кодом области GeoNames. */
const REGION_CODES = DIRECTORY.regions as Record<string, string>;

/**
 * Ключ поиска. Помимо обычного приведения к нижнему регистру убираем различия
 * украинской и русской раскладки: «Черніг» и «Черниг» должны находить одно и то же.
 */
function searchKey(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ї/gu, 'и')
    .replace(/і/gu, 'и')
    .replace(/є/gu, 'е')
    .replace(/ґ/gu, 'г')
    .trim();
}

// Ключи для бинарного поиска считаем один раз при старте воркера, а не на каждый запрос.
const KEYS: string[] = PLACES.map((place) => searchKey(place[0]));

export interface SettlementHit {
  name: string;
  regionCode: string;
  lat: number;
  lon: number;
}

/**
 * Ищет населённые пункты по началу названия.
 *
 * Порог в 2 символа — тот же, что и у мастера в интерфейсе: при одном символе в Украине
 * десятки совпадений, и такая выдача бесполезна.
 */
export function searchSettlements(prefix: string, regionCpu: string | undefined, limit: number): SettlementHit[] {
  const needle = searchKey(prefix);
  if (needle.length < 2) return [];

  // Поиск только по своей области, если она есть в справочнике. Для регионов, которых в
  // справочнике нет (например, отдельные энергосистемы Днепра), фильтр не применяем — иначе
  // подсказки были бы пустыми вопреки тому, что города там есть.
  const regionCode = regionCpu ? REGION_CODES[regionCpu] : undefined;

  // Бинарный поиск первого элемента с заданным префиксом: массив отсортирован по ключу.
  let low = 0;
  let high = KEYS.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (KEYS[mid]! < needle) low = mid + 1;
    else high = mid;
  }

  const hits: SettlementHit[] = [];
  for (let index = low; index < KEYS.length; index += 1) {
    const key = KEYS[index]!;
    if (!key.startsWith(needle)) break;
    const place = PLACES[index]!;
    if (regionCode && place[1] !== regionCode) continue;
    hits.push({ name: place[0], regionCode: place[1], lat: place[2], lon: place[3] });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Есть ли регион в справочнике — нужно, чтобы понимать, применим фильтр по области. */
export function hasRegionCode(regionCpu: string | undefined): boolean {
  return Boolean(regionCpu && REGION_CODES[regionCpu]);
}
