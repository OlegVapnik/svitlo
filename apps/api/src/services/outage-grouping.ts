/**
 * Згортання дублікатів відключень, що відрізняються лише адресами.
 *
 * Оператор віддає по одному рядку на вулицю/будинок, хоча в селі світло вимикають
 * одразу по всьому населеному пункту. Через це одна подія займала десятки рядків
 * («смітила») у списках і на сторінці «Аварії». Групуємо за ключем без адрес:
 * населений пункт + час початку + час завершення + причина.
 */

export interface GroupableOutage {
  startsAt: Date;
  endsAt: Date;
  areaName: string;
  addressesRaw: string;
  reason?: string | null;
}

const STREET_IN_ADDRESS = /вул\.?\s*[^,;\d]+/iu;

/** Витягує назву вулиці з рядка адрес (або null, якщо вулиці немає). */
export function streetFromAddresses(addresses: string): string | null {
  const match = String(addresses ?? '').match(STREET_IN_ADDRESS);
  return match ? match[0].replace(/[\s,;]+$/u, '').replace(/\s+/gu, ' ').trim() : null;
}

/**
 * Стислий опис постраждалих адрес: унікальні вулиці замість сотень номерів будинків.
 * Для однієї вулиці повертаємо оригінальний рядок (номери будинків бувають корисні).
 */
export function summarizeAffectedAddresses(addresses: string[]): string {
  const streets: string[] = [];
  for (const item of addresses) {
    const street = streetFromAddresses(item);
    if (street && !streets.includes(street)) streets.push(street);
  }
  if (streets.length === 0) return (addresses[0] ?? '').trim();
  if (streets.length === 1) return (addresses[0] ?? streets[0]!).trim();
  const shown = streets.slice(0, 4).join(', ');
  return streets.length > 4 ? `${shown} та інші вулиці` : shown;
}

/** Ключ події — усе, крім адрес і часу завершення: саме вони й створювали «дублікати».
 *  Одне й те саме відключення з різним `endsAt` по різних вулицях (оператор оновлює
 *  час завершення окремих адрес) зливається в одну подію; `upsertOutageEvent` потім
 *  пише `least(starts_at)` / `greatest(ends_at)` (HANDOFF §9.4). */
export function outageEventKey(row: GroupableOutage): string {
  return [
    row.areaName.trim().toLocaleLowerCase('uk-UA'),
    row.startsAt.toISOString(),
    (row.reason ?? '').trim().toLocaleLowerCase('uk-UA'),
  ].join('|');
}

/** Згортає дублікати (різні адреси тієї самої події) в один запис. */
export function mergeDuplicateOutages<T extends GroupableOutage>(rows: T[]): T[] {
  const groups = new Map<string, { row: T; addresses: string[] }>();
  for (const input of rows) {
    const key = outageEventKey(input);
    const group = groups.get(key);
    if (group) {
      group.addresses.push(input.addressesRaw);
      continue;
    }
    groups.set(key, { row: { ...input }, addresses: [input.addressesRaw] });
  }
  return Array.from(groups.values()).map(({ row, addresses }) => ({
    ...row,
    addressesRaw: summarizeAffectedAddresses(addresses),
  }));
}
