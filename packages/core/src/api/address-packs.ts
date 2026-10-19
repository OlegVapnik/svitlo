/**
 * Статический справочник адресов с CDN (Cloudflare Pages).
 *
 * Зачем: публичный автокомплит не должен читать D1 на каждый символ. Ночная сборка
 * (`tools/build-address-packs.py`) кладёт НП/улицы/дома в неизменяемые JSON-файлы, а клиент
 * ищет по ним локально. D1 остаётся источником графиков, а не поисковым движком.
 *
 * Контракт manifest.json (version 2):
 *   { version, generatedAt, regions: { [cpu]: {
 *       settlements: { url, hash, count },
 *       shards: { [перваяБукваНП]: { url, hash, count } },
 *       houses: { [0..15]: { url, hash, count } }
 *   } } }
 *
 * Индекс улиц не содержит домов: открытие «Поиска» в Киеве не должно парсить дома всех
 * 2 400 улиц. Дома лежат в отдельном шарде улицы и читаются только после выбора улицы.
 *
 * Пустой/недоступный пак — не ошибка: вызывающий код откатывается на серверный API.
 */

import type {
  AddressHouseOption,
  AddressHousesResponse,
  AddressResolveResult,
  AddressStreetsResponse,
} from '@svitlo/shared';
import { matchHouseNumber, normalizeAddress, normalizeHouseNumber } from '../lib/address';
import { storage } from '../storage';

export interface AddressPackRef {
  url: string;
  hash: string;
  count: number;
  bytes?: number;
}

export interface AddressPackRegion {
  settlements: AddressPackRef;
  shards: Record<string, AddressPackRef>;
  /** Шарды домов по номеру 0..15. В старых паках отсутствует. */
  houses?: Record<string, AddressPackRef>;
  settlementsCount?: number;
  streetsCount?: number;
}

export interface AddressPackManifest {
  version: number;
  generatedAt: string;
  regions: Record<string, AddressPackRegion>;
}

export interface PackSettlement {
  name: string;
  normalized: string;
  queues: string[];
  streetsCount: number;
}

/**
 * Компактный кортеж улицы: [название, нормализованный ключ, группа улицы, группы, шард домов].
 * Массив вместо объекта — индекс Киева остаётся лёгким, а поиск идёт по готовому `normalized`.
 */
export type PackStreet = [string, string, string | null, string[], number | null];

const STREET_NAME = 0;
const STREET_NORMALIZED = 1;
const STREET_DEFAULT_QUEUE = 2;
const STREET_QUEUES = 3;
const STREET_HOUSES_SHARD = 4;

interface SettlementsPack {
  region: string;
  settlements: PackSettlement[];
}

interface StreetsPack {
  region: string;
  shard: string;
  settlements: Record<string, { settlement: string; settlementNormalized: string; streets: PackStreet[] }>;
}

interface HousesPack {
  region: string;
  shard: number;
  streets: Record<string, Array<[string, string | null]>>;
}

/**
 * Адрес CDN-паков. В вебе это относительный путь (`/data/address`), в React Native — абсолютный
 * URL Pages; мобильное приложение задаёт его на старте.
 */
let packsBaseUrl = '/data/address';

export function configureAddressPacks(options: { baseUrl: string }): void {
  packsBaseUrl = options.baseUrl.replace(/\/+$/u, '');
}

export function getAddressPacksBaseUrl(): string {
  return packsBaseUrl;
}

const MANIFEST_KEY = 'svitlo:address-packs:manifest:v1';
const PACK_KEY_PREFIX = 'svitlo:address-packs:pack:v1:';
const MANIFEST_TTL_MS = 60 * 60_000;
/** Один пак больше этого не кладём в KV: на вебе localStorage не резиновый. */
const MAX_STORED_PACK_CHARS = 2_500_000;

const memory = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();

interface StoredPack<T> {
  hash: string;
  data: T;
}

function readStored<T>(key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Квота KV исчерпана — пак всё равно придёт по сети в следующий раз.
  }
}

function urlOf(ref: AddressPackRef): string {
  return `${packsBaseUrl}/${ref.url}`;
}

async function loadPack<T>(ref: AddressPackRef): Promise<T> {
  const key = `${PACK_KEY_PREFIX}${ref.url}`;
  const cachedMemory = memory.get(key);
  if (cachedMemory) return cachedMemory as T;

  const stored = readStored<StoredPack<T>>(key);
  if (stored && stored.hash === ref.hash) {
    memory.set(key, stored.data);
    return stored.data;
  }

  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    const response = await fetch(urlOf(ref), { cache: 'force-cache' });
    if (!response.ok) throw new Error(`address-pack ${response.status}: ${ref.url}`);
    const data = (await response.json()) as T;
    memory.set(key, data);
    const serialized = JSON.stringify(data);
    if (serialized.length <= MAX_STORED_PACK_CHARS) {
      writeStored(key, { hash: ref.hash, data } satisfies StoredPack<T>);
    }
    return data;
  })().finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

/**
 * Манифест паков. Час держим в памяти/KV, но при сетевой ошибке отдаём прошлый: без манифеста
 * адресный мастер молча ушёл бы в D1, а этого мы как раз избегаем.
 */
export async function loadAddressPackManifest(force = false): Promise<AddressPackManifest | null> {
  const cacheKey = 'manifest';
  const cachedMemory = memory.get(cacheKey) as { at: number; data: AddressPackManifest } | undefined;
  if (!force && cachedMemory && Date.now() - cachedMemory.at < MANIFEST_TTL_MS) return cachedMemory.data;

  const stored = readStored<{ at: number; data: AddressPackManifest }>(MANIFEST_KEY);
  if (!force && stored && Date.now() - stored.at < MANIFEST_TTL_MS) {
    memory.set(cacheKey, stored);
    return stored.data;
  }

  try {
    const response = await fetch(`${packsBaseUrl}/manifest.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`address-manifest ${response.status}`);
    const data = (await response.json()) as AddressPackManifest;
    if (!data || typeof data !== 'object' || !data.regions) throw new Error('address-manifest: bad payload');
    const entry = { at: Date.now(), data };
    memory.set(cacheKey, entry);
    writeStored(MANIFEST_KEY, entry);
    return data;
  } catch {
    if (cachedMemory) return cachedMemory.data;
    if (stored) return stored.data;
    return null;
  }
}

function shardKey(settlementNormalized: string): string {
  const first = (settlementNormalized || '').slice(0, 1);
  return /^[абвгґдеєжзиіїйклмнопрстуфхцчшщьюя]$/u.test(first) ? first : 'other';
}

function byQuery(needle: string): (value: string) => number {
  if (!needle) return () => 1;
  return (value) => (value.startsWith(needle) ? 0 : value.includes(needle) ? 1 : 2);
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, 'uk', { numeric: true, sensitivity: 'base' });
}

async function loadSettlementsPack(region: string): Promise<PackSettlement[] | null> {
  const manifest = await loadAddressPackManifest();
  const ref = manifest?.regions?.[region]?.settlements;
  if (!ref) return null;
  try {
    const pack = await loadPack<SettlementsPack>(ref);
    return pack.settlements ?? [];
  } catch {
    return null;
  }
}

async function findSettlement(region: string, input: string): Promise<PackSettlement | null> {
  const settlements = await loadSettlementsPack(region);
  if (!settlements || settlements.length === 0) return null;
  const needle = normalizeAddress(input);
  if (!needle) return null;

  const exact = settlements.find((item) => item.normalized === needle);
  if (exact) return exact;

  const starts = settlements
    .filter((item) => item.normalized.startsWith(needle))
    .sort((left, right) => naturalCompare(left.name, right.name));
  if (starts.length === 1) return starts[0]!;

  const inside = settlements
    .filter((item) => item.normalized.includes(needle))
    .sort((left, right) => naturalCompare(left.name, right.name));
  return inside.length === 1 ? inside[0]! : null;
}

/** Подсказки НП из пака; `null` — пака для области нет (нужен серверный фолбэк). */
export async function searchPackSettlements(
  region: string,
  query: string,
  limit = 8,
): Promise<PackSettlement[] | null> {
  const settlements = await loadSettlementsPack(region);
  if (!settlements) return null;
  const needle = normalizeAddress(query);
  if (needle.length < 2) return [];
  return settlements
    .filter((item) => item.normalized.includes(needle))
    .sort(
      (left, right) =>
        byQuery(needle)(left.normalized) - byQuery(needle)(right.normalized) ||
        right.streetsCount - left.streetsCount ||
        naturalCompare(left.name, right.name),
    )
    .slice(0, limit);
}

/** НП с наибольшим числом улиц — быстрый вход, когда поле ещё пустое. */
export async function topPackSettlements(region: string, limit = 6): Promise<PackSettlement[] | null> {
  const settlements = await loadSettlementsPack(region);
  if (!settlements) return null;
  return [...settlements]
    .sort((left, right) => right.streetsCount - left.streetsCount || naturalCompare(left.name, right.name))
    .slice(0, limit);
}

interface ShardData {
  settlement: PackSettlement;
  streets: PackStreet[];
}

async function loadSettlementStreets(region: string, settlement: PackSettlement): Promise<ShardData | null> {
  const manifest = await loadAddressPackManifest();
  const ref = manifest?.regions?.[region]?.shards?.[shardKey(settlement.normalized)];
  if (!ref) return null;
  try {
    const shard = await loadPack<StreetsPack>(ref);
    const entry = shard.settlements?.[settlement.normalized];
    return entry ? { settlement, streets: entry.streets ?? [] } : null;
  } catch {
    return null;
  }
}

/**
 * Улицы НП из пака; `null` — пака/НП нет, вызывающий откатывается на API.
 *
 * Возвращаем не больше 30 подсказок и не сортируем весь массив: генератор уже отсортировал
 * улицы по нормализованному ключу. Сначала идут совпадения с начала строки, затем вхождения
 * внутрь. Для пустого запроса отдаём первые `limit` улиц (алфавитный обзор), а не весь город.
 */
export async function fetchPackStreets(
  region: string,
  settlementInput: string,
  query: string,
  limit = 20,
): Promise<AddressStreetsResponse | null> {
  const settlement = await findSettlement(region, settlementInput);
  if (!settlement) return null;
  const data = await loadSettlementStreets(region, settlement);
  if (!data) return null;

  const max = Math.min(limit, 30);
  const needle = normalizeAddress(query);
  const streets: Array<{ name: string; normalized: string }> = [];
  const push = (street: PackStreet): boolean => {
    streets.push({ name: street[STREET_NAME], normalized: street[STREET_NORMALIZED] });
    return streets.length >= max;
  };

  if (!needle) {
    for (const street of data.streets) {
      if (push(street)) break;
    }
  } else {
    for (const street of data.streets) {
      if (street[STREET_NORMALIZED].startsWith(needle) && push(street)) break;
    }
    if (streets.length < max) {
      for (const street of data.streets) {
        const normalized = street[STREET_NORMALIZED];
        if (normalized.startsWith(needle) || !normalized.includes(needle)) continue;
        if (push(street)) break;
      }
    }
  }

  return {
    data: streets,
    wholeSettlementQueue: settlement.queues.length === 1 ? settlement.queues[0]! : null,
    region,
  };
}

async function loadStreetHouses(
  region: string,
  settlement: PackSettlement,
  street: PackStreet,
): Promise<AddressHouseOption[]> {
  const shard = street[STREET_HOUSES_SHARD];
  if (shard === null) return [];
  const manifest = await loadAddressPackManifest();
  const ref = manifest?.regions?.[region]?.houses?.[String(shard)];
  if (!ref) return [];
  try {
    const pack = await loadPack<HousesPack>(ref);
    const key = `${settlement.normalized}|${street[STREET_NORMALIZED]}`;
    const rows = pack.streets?.[key] ?? [];
    return rows
      .filter(([, queue]) => Boolean(queue))
      .map(([housePattern, queue]) => ({ housePattern, queue: queue! }));
  } catch {
    return [];
  }
}

/** Дома улицы с группами; `null` — пака/улицы нет, нужен серверный фолбэк. */
export async function fetchPackHouses(
  region: string,
  settlementInput: string,
  streetInput: string,
): Promise<AddressHousesResponse | null> {
  const settlement = await findSettlement(region, settlementInput);
  if (!settlement) return null;
  const data = await loadSettlementStreets(region, settlement);
  if (!data) return null;
  const streetNorm = normalizeAddress(streetInput);
  const street = data.streets.find((item) => item[STREET_NORMALIZED] === streetNorm);
  if (!street) return null;
  const houses = await loadStreetHouses(region, settlement, street);
  const whole =
    street[STREET_DEFAULT_QUEUE] ??
    (houses.length === 0 && street[STREET_QUEUES].length === 1 ? street[STREET_QUEUES][0]! : null);
  return { data: houses, wholeStreetQueue: whole };
}

function findHouse(houses: AddressHouseOption[], houseInput: string): AddressHouseOption | null {
  const target = normalizeHouseNumber(houseInput);
  if (!target) return null;

  const exact = houses.find((item) => normalizeHouseNumber(item.housePattern) === target);
  if (exact) return exact;

  return houses.find((item) => matchHouseNumber(houseInput, item.housePattern)) ?? null;
}

/**
 * Полный ответ мастера по статическому паку. `null` — области/НП нет в паке; вызывающий
 * делает серверный resolve. Найденный НП всегда даёт результат (пусть и `not-found`), чтобы
 * не ходить в D1 за заведомо отсутствующим адресом.
 */
export async function resolvePackAddress(
  region: string,
  params: { settlement: string; street?: string; house?: string },
): Promise<AddressResolveResult | null> {
  const settlement = await findSettlement(region, params.settlement);
  if (!settlement) return null;
  const data = await loadSettlementStreets(region, settlement);
  if (!data) return null;

  const streetNorm = normalizeAddress(params.street ?? '');
  const street = streetNorm
    ? data.streets.find((item) => item[STREET_NORMALIZED] === streetNorm) ??
      data.streets.find((item) => item[STREET_NORMALIZED].includes(streetNorm)) ??
      null
    : null;

  if (!params.street?.trim()) {
    if (settlement.queues.length === 1) {
      return {
        queue: settlement.queues[0]!,
        options: [],
        reason: 'whole-settlement',
        source: 'operator',
        confidence: 'official',
        schedule: null,
      };
    }
    return { queue: null, options: [], reason: 'not-found', source: null, confidence: null, schedule: null };
  }

  if (!street) {
    return { queue: null, options: [], reason: 'not-found', source: null, confidence: null, schedule: null };
  }

  const houses = await loadStreetHouses(region, settlement, street);
  if (params.house?.trim()) {
    const found = findHouse(houses, params.house);
    if (found) {
      return {
        queue: found.queue,
        options: houses.slice(0, 50),
        reason: 'exact-house',
        source: 'operator',
        confidence: 'official',
        schedule: null,
      };
    }
    return {
      queue: null,
      options: houses.slice(0, 50),
      reason: 'not-found',
      source: null,
      confidence: null,
      schedule: null,
    };
  }

  if (street[STREET_DEFAULT_QUEUE]) {
    return {
      queue: street[STREET_DEFAULT_QUEUE],
      options: houses.slice(0, 50),
      reason: 'whole-street',
      source: 'operator',
      confidence: 'official',
      schedule: null,
    };
  }
  if (houses.length === 0 && street[STREET_QUEUES].length === 1) {
    return {
      queue: street[STREET_QUEUES][0]!,
      options: [],
      reason: 'whole-street',
      source: 'operator',
      confidence: 'official',
      schedule: null,
    };
  }
  return {
    queue: null,
    options: houses.slice(0, 50),
    reason: 'not-found',
    source: null,
    confidence: null,
    schedule: null,
  };
}
