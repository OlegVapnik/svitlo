/**
 * Компактний офлайн-пак адрес регіону (v2) — чистий домен, без I/O.
 *
 * Формат: словник унікальних рядків (`dict`) + масиви індексів. Назви НП і вулиць
 * кладуться у словник один раз, тому повторювані частини («вул.» у сотнях вулиць,
 * спільні назви вулиць у різних НП) серіалізуються одним індексом на входження.
 * Коди черг — окремим словником (`queues`), бо повторюються найчастіше.
 *
 * Будинки у v2 НЕ зберігаємо: зв'язок пошуку — «вулиця → черги».
 */

import { normalizeAddress } from './address.ts';

export interface AddressPackSettlement {
  /** Індекс назви НП у `dict`. */
  name: number;
  /** Індекс коду черги за замовчуванням у `queues`. */
  defaultQueue: number;
}

export interface AddressPackStreet {
  /** Індекс НП у `settlements` (вулиці НП лежать підряд, групою). */
  settlement: number;
  /** Індекс назви вулиці у `dict`. */
  name: number;
  /** Індекси кодів черг у `queues` (у пріоритеті джерела). */
  queues: number[];
}

export interface AddressPack {
  version: 2;
  region: string;
  generatedAt: string;
  /** Словник рядків: імена НП і вулиць кладемо сюди один раз. */
  dict: string[];
  settlements: AddressPackSettlement[];
  streets: AddressPackStreet[];
  /** Словник кодів черг («1/1», «6/2», …). */
  queues: string[];
}

export interface AddressPackInput {
  region: string;
  settlements: Array<{
    name: string;
    defaultQueue: string;
    streets: Array<{ name: string; queues: string[] }>;
  }>;
}

export interface AddressPackMatch {
  settlement: string;
  street: string | null;
  /** Коди черг; для збігу без вулиці — черга за замовчуванням НП. */
  queues: string[];
}

/** Індекс у словнику: наявне значення не дублюємо. */
function dictId(dict: string[], seen: Map<string, number>, value: string): number {
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  const added = dict.length;
  dict.push(value);
  seen.set(value, added);
  return added;
}

/** Порядок пошуку в словнику черг: наявне значення не дублюємо. */
function queueId(queues: string[], seen: Map<string, number>, value: string): number {
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  const added = queues.length;
  queues.push(value);
  seen.set(value, added);
  return added;
}

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return '';
  }
}

/** Збирає пак із «живих» даних: словники будуються на льоту, дублікати злипаються в один індекс. */
export function buildAddressPack(input: AddressPackInput): AddressPack {
  const dict: string[] = [];
  const dictSeen = new Map<string, number>();
  const queues: string[] = [];
  const queueSeen = new Map<string, number>();
  const settlements: AddressPackSettlement[] = [];
  const streets: AddressPackStreet[] = [];

  for (const settlement of input.settlements ?? []) {
    const settlementIndex = settlements.length;
    settlements.push({
      name: dictId(dict, dictSeen, String(settlement.name ?? '').trim()),
      defaultQueue: queueId(queues, queueSeen, String(settlement.defaultQueue ?? '').trim()),
    });
    for (const street of settlement.streets ?? []) {
      const streetQueues = (street.queues ?? [])
        .map((queue) => String(queue ?? '').trim())
        .filter((queue) => queue !== '')
        .map((queue) => queueId(queues, queueSeen, queue));
      streets.push({
        settlement: settlementIndex,
        name: dictId(dict, dictSeen, String(street.name ?? '').trim()),
        // Дублікати в межах однієї вулиці не потрібні, порядок джерела зберігаємо.
        queues: [...new Set(streetQueues)],
      });
    }
    // Порожня група (НП без вулиць) — легальна.
  }

  return {
    version: 2,
    region: String(input.region ?? '').trim(),
    generatedAt: nowIso(),
    dict,
    settlements,
    streets,
    queues,
  };
}

/** Якість збігу: -1 — немає, 0 — точний, 1 — префікс, 2 — підстрока. */
function matchKind(name: string, query: string): number {
  if (name === '') return -1;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return -1;
}

/**
 * Розгорнуті черги вулиці: індекси → коди; биті індекси мовчки відкидаємо.
 */
function queueCodes(pack: AddressPack, street: AddressPackStreet | null, settlement: AddressPackSettlement): string[] {
  if (street) {
    return street.queues
      .map((index) => pack.queues[index])
      .filter((code): code is string => typeof code === 'string' && code !== '');
  }
  const only = pack.queues[settlement.defaultQueue];
  return typeof only === 'string' && only !== '' ? [only] : [];
}

/**
 * Пошук у паку. Нормалізація та сама, що в онлайн-пошуку (`normalizeAddress`):
 * «Черніг. Чернігівська» і «чернігів» дають однаковий ключ.
 *
 * Стратегія:
 * 1) Точний збіг НП → шукаємо вулиці лише в ньому; якщо жодна не пасує —
 *    віддаємо сам НП із чергою за замовчуванням.
 * 2) Інакше (префікс/підстрока НП або вулиця) — кандидати зі всіх НП:
 *    і самі НП, і їхні вулиці, ранжування точний > префікс > підстрока.
 * НП без вулиці зазвичай і є відповіддю «запит — назва НП».
 */
export function searchAddressInPack(pack: AddressPack, query: string, limit = 8): AddressPackMatch[] {
  const normalized = normalizeAddress(query);
  if (normalized === '') return [];

  const cap = Math.max(0, Math.trunc(limit));
  if (cap === 0) return [];

  interface Candidate {
    settlement: number;
    street: number | null;
    /** Оскільки точний НП — «обрана» зона, його кандидати йдуть вище за інші. */
    anchor: 0 | 1;
    kind: number;
  }
  const candidates: Candidate[] = [];

  // Нормалізовані назви рахуємо по одному разу на прохід.
  const settlementNames = pack.settlements.map((s) => normalizeAddress(pack.dict[s.name] ?? ''));

  pack.settlements.forEach((_settlement, index) => {
    const settlementKind = matchKind(settlementNames[index]!, normalized);
    if (settlementKind === 0) {
      // Обраний НП: беремо лише його вулиці (за тим самим запитом).
      let matchedStreets = 0;
      for (let s = 0; s < pack.streets.length; s++) {
        const street = pack.streets[s]!;
        if (street.settlement !== index) continue;
        const kind = matchKind(normalizeAddress(pack.dict[street.name] ?? ''), normalized);
        if (kind === -1) continue;
        candidates.push({ settlement: index, street: s, anchor: 0, kind });
        matchedStreets++;
      }
      // У обраному НП вулиць під запит немає — повертаємо сам НП із дефолтною чергою.
      if (matchedStreets === 0) candidates.push({ settlement: index, street: null, anchor: 0, kind: 0 });
      return;
    }
    // Не-точний НП: беремо і його вулиці, і його назву.
    for (let s = 0; s < pack.streets.length; s++) {
      const street = pack.streets[s]!;
      if (street.settlement !== index) continue;
      const kind = matchKind(normalizeAddress(pack.dict[street.name] ?? ''), normalized);
      if (kind === -1) continue;
      candidates.push({ settlement: index, street: s, anchor: settlementKind === -1 ? 1 : 0, kind });
    }
    if (settlementKind >= 1) candidates.push({ settlement: index, street: null, anchor: 1, kind: settlementKind });
  });

  candidates.sort(
    (left, right) =>
      left.anchor - right.anchor ||
      left.kind - right.kind ||
      left.settlement - right.settlement ||
      (left.street ?? 0) - (right.street ?? 0),
  );

  const out: AddressPackMatch[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const settlement = pack.settlements[candidate.settlement]!;
    const settlementName = pack.dict[settlement.name] ?? '';
    const street = candidate.street === null ? null : pack.streets[candidate.street]!;
    const streetName = street ? (pack.dict[street.name] ?? '') : null;
    const key = `${settlementName}\u0000${streetName ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ settlement: settlementName, street: streetName, queues: queueCodes(pack, street, settlement) });
    if (out.length >= cap) break;
  }
  return out;
}
