import { db } from '../db/connection.js';
import { addressQueues } from '../db/schema.js';
import { and, asc, eq, sql } from 'drizzle-orm';
import { normalizeQueueCode } from '../providers/intervals.js';
import { matchHouseNumber, parseHouseNumber, describeHousePattern } from './house-number.js';

/**
 * Поиск своей группы ГПВ по адресу: область → населённый пункт → улица → дом.
 *
 * Ключевое ограничение проекта: группы НЕ выдумываются. Если в базе нет привязки адреса к
 * очереди, сервис так и говорит («привязки нет»), а не подставляет «похожую» группу. Человек
 * посмотрит на выдуманный номер и будет сверяться с отключением не своей группы.
 */

/** Нормализация ввода пользователя тем же правилом, что и в БД (energy_normalize_address). */
export async function normalizeAddress(input: string): Promise<string> {
  // Нормализация живёт в Postgres (unaccent + синонимы «вул.» → «вулиця»), поэтому используем
  // её же: иначе «вул. Шевченка» и «Шевченко» не совпали бы по индексу.
  const rows = await db.execute(sql`SELECT energy_normalize_address(${input}) AS value`);
  const value = (rows as unknown as Array<{ value: string }>)[0]?.value ?? '';
  return String(value).trim();
}

/**
 * Канонический вид кода группы для показа.
 *
 * `normalizeQueueCode` возвращает null для нераспознанного кода — тогда отдаём исходную строку
 * как есть: она уже лежит в базе (значит, пришла из источника), и молча выбрасывать её нельзя.
 * Но и «придумывать» код нельзя, поэтому подстановки тут нет.
 */
export function canonicalQueue(raw: string): string {
  return normalizeQueueCode(raw) ?? String(raw ?? '').trim();
}

/**
 * Годится ли строка как код группы («1/1», «6/2», «3»). Му��ор в базу не пускаем: иначе один
 * опечатанный ввод отравил бы подсказки всем соседям, а не только автору.
 */
export function isQueueCode(value: string): boolean {
  return /^\d{1,2}(?:\/\d{1,2})?$/u.test(String(value ?? '').trim());
}

export { matchHouseNumber };

/** Варианты домов на улице, если групп несколько — чтобы показать пользователю выбор. */
export interface StreetHouseRange {
  housePattern: string;
  queue: string;
}

export interface ResolveResult {
  /** Найденная группа; null — привязки нет. */
  queue: string | null;
  /** Несколько групп на одной улице: подсказка «какие диапазоны к какой группе». */
  options: StreetHouseRange[];
  /** Чем закончился поиск — для честного сообщения в UI. */
  reason: 'exact-house' | 'whole-street' | 'whole-settlement' | 'not-found';
  /** Откуда взята привязка. */
  source: string | null;
}

/**
 * Трёхуровневый поиск группы по адресу.
 *
 * Уровни идут от точного к общему, бо перебросить на «группа на всю улицу» при введённом
 * номере дома опасно: человек увидит не ту группу.
 */
export async function resolveQueueByAddress(input: {
  region: string;
  settlement: string;
  street?: string;
  house?: string;
}): Promise<ResolveResult> {
  const region = input.region.trim();
  const settlementNormalized = await normalizeAddress(input.settlement);
  if (!region || !settlementNormalized) {
    return { queue: null, options: [], reason: 'not-found', source: null };
  }

  const settlementRows = await db
    .select()
    .from(addressQueues)
    .where(and(eq(addressQueues.region, region), eq(addressQueues.settlementNormalized, settlementNormalized)))
    .orderBy(asc(addressQueues.streetName), asc(addressQueues.housePattern));

  const settlementEntries = settlementRows;
  if (settlementEntries.length === 0) {
    return { queue: null, options: [], reason: 'not-found', source: null };
  }

  // Уровень 3: группа на весь НП целиком (пустые street_normalized).
  const wholeSettlement = settlementEntries.find((row) => row.streetNormalized === '');
  if (wholeSettlement) {
    return {
      queue: canonicalQueue(wholeSettlement.queue),
      options: [],
      reason: 'whole-settlement',
      source: wholeSettlement.source,
    };
  }

  const street = (input.street ?? '').trim();
  if (!street) {
    // Название НП есть, а улица не указана: если на НП ровно одна группа — это и есть ответ.
    const queues = new Set(settlementEntries.map((row) => canonicalQueue(row.queue)));
    if (settlementEntries.length > 0 && queues.size === 1) {
      return {
        queue: [...queues][0]!,
        options: [],
        reason: 'whole-settlement',
        source: settlementEntries[0]!.source,
      };
    }
    // Иначе показать варианты по улицам — что увидит человек на шаге «улица».
    return {
      queue: null,
      options: settlementEntries.map((row) => ({
        housePattern: `${row.streetName}${row.housePattern === '*' ? '' : ` (${row.housePattern})`}`,
        queue: canonicalQueue(row.queue),
      })),
      reason: 'not-found',
      source: null,
    };
  }

  const streetNormalized = await normalizeAddress(street);
  const streetRows = settlementEntries.filter((row) => row.streetNormalized === streetNormalized);

  if (streetRows.length === 0) {
    return { queue: null, options: [], reason: 'not-found', source: null };
  }

  const house = (input.house ?? '').trim();

  // Уровень 1: конкретный дом. Проверяем ДО общей записи улицы: на улице может быть
  // «2/2 до 15-го» и «3/2 с 16-го», и при введённом номере выбор очевиден.
  if (house) {
    const exact = streetRows.filter((row) => row.housePattern !== '*' && matchHouseNumber(house, row.housePattern));
    if (exact.length > 0) {
      return {
        queue: canonicalQueue(exact[0]!.queue),
        options: [],
        reason: 'exact-house',
        source: exact[0]!.source,
      };
    }
  }

  // Уровень 2: вся улица одной группой.
  const wholeStreet = streetRows.find((row) => row.housePattern === '*');
  if (wholeStreet) {
    return {
      queue: canonicalQueue(wholeStreet.queue),
      options: [],
      reason: 'whole-street',
      source: wholeStreet.source,
    };
  }

  // Дом не введён или ни один шаблон не подошёл — отдаём варианты, чтобы человек выбрал
  // диапазон сам, вместо того чтобы угадывать за него.
  const options: StreetHouseRange[] = streetRows.map((row) => ({
    housePattern: row.housePattern,
    queue: canonicalQueue(row.queue),
  }));
  const queue = house && options.length === 1 ? options[0]!.queue : null;
  return { queue, options, reason: 'not-found', source: queue ? streetRows[0]!.source : null };
}

/** Автодополнение населённых пунктов области. */
export async function suggestSettlements(
  region: string,
  search: string,
  limit = 10,
): Promise<string[]> {
  const normalized = await normalizeAddress(search);
  if (!normalized) return [];
  const rows = await db
    .selectDistinct({ name: addressQueues.settlementName })
    .from(addressQueues)
    .where(and(eq(addressQueues.region, region), sql`${addressQueues.settlementNormalized} LIKE ${normalized + '%'}`))
    .limit(limit);
  return rows.map((row) => row.name);
}

/** Автодополнение улиц внутри населённого пункта + признак группы на весь НП. */
export async function suggestStreets(
  region: string,
  settlement: string,
  search: string,
  limit = 10,
): Promise<Array<{ name: string; wholeSettlementQueue: string | null }>> {
  const settlementNormalized = await normalizeAddress(settlement);
  if (!settlementNormalized) return [];
  const normalized = await normalizeAddress(search);

  const where = normalized
    ? and(
        eq(addressQueues.region, region),
        eq(addressQueues.settlementNormalized, settlementNormalized),
        sql`${addressQueues.streetNormalized} LIKE ${normalized + '%'}`,
      )
    : and(
        eq(addressQueues.region, region),
        eq(addressQueues.settlementNormalized, settlementNormalized),
        sql`${addressQueues.streetNormalized} <> ''`,
      );

  const rows = await db
    .selectDistinct({ name: addressQueues.streetName, source: addressQueues.source })
    .from(addressQueues)
    .where(where)
    .orderBy(asc(addressQueues.streetName))
    .limit(limit);

  const wholeSettlement = await db
    .select({ queue: addressQueues.queue })
    .from(addressQueues)
    .where(
      and(
        eq(addressQueues.region, region),
        eq(addressQueues.settlementNormalized, settlementNormalized),
        eq(addressQueues.streetNormalized, ''),
      ),
    )
    .limit(1);

  return rows
    .filter((row) => row.name !== '')
    .map((row) => ({ name: row.name, wholeSettlementQueue: wholeSettlement[0] ? canonicalQueue(wholeSettlement[0].queue) : null }));
}

/**
 * Дома выбранной улицы с их группами — для чипов «12 → 2/2» в мастере адреса.
 *
 * Отдаём только реальные записи `address_queues`: если домов нет, список пуст, и интерфейс
 * предлагает ввести номер вручную. Придумывать диапазоны домов нельзя — человек сверится не с
 * той группой.
 */
export async function listAddressHouses(input: {
  region: string;
  settlement: string;
  street: string;
}): Promise<{ data: StreetHouseRange[]; wholeStreetQueue: string | null }> {
  const region = input.region.trim();
  const settlementNormalized = await normalizeAddress(input.settlement);
  const streetNormalized = await normalizeAddress(input.street);
  if (!region || !settlementNormalized || !streetNormalized) return { data: [], wholeStreetQueue: null };

  const rows = await db
    .select({ housePattern: addressQueues.housePattern, queue: addressQueues.queue })
    .from(addressQueues)
    .where(
      and(
        eq(addressQueues.region, region),
        eq(addressQueues.settlementNormalized, settlementNormalized),
        eq(addressQueues.streetNormalized, streetNormalized),
      ),
    )
    .limit(400);

  const whole = rows.find((row) => row.housePattern === '*' || row.housePattern === '');
  const seen = new Set<string>();
  const data: StreetHouseRange[] = [];
  for (const row of rows) {
    if (row.housePattern === '*' || row.housePattern === '') continue;
    const queue = canonicalQueue(row.queue);
    const key = `${row.housePattern}|${queue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    data.push({ housePattern: row.housePattern, queue });
  }

  return { data: data.slice(0, 200), wholeStreetQueue: whole ? canonicalQueue(whole.queue) : null };
}

export interface ImportRow {
  region: string;
  settlement: string;
  street?: string;
  housePattern?: string;
  queue: string;
}

/**
 * Массовый импорт привязок адрес → группа.
 *
 * Нужен для наполнения базы выгрузками обленерго и ручными таблицами. Пропускает мусорные
 * строки (пустая группа, неизвестный формат кода) и считает их: молча проглоченная ошибка
 * при импорте выглядит как «импорт прошёл», а данные не появились.
 */
export async function importAddressQueuesBatch(
  rows: ImportRow[],
  source = 'manual',
): Promise<{ imported: number; skipped: number; reasons: string[] }> {
  const reasons = new Set<string>();
  const values: Array<typeof addressQueues.$inferInsert> = [];

  for (const row of rows) {
    const settlementNormalized = await normalizeAddress(String(row.settlement ?? ''));
    if (!row.region || !settlementNormalized || !row.queue) {
      reasons.add('пустая область, населённый пункт или очередь');
      continue;
    }
    const queue = normalizeQueueCode(row.queue);
    if (!queue) {
      reasons.add(`некорректный код очереди «${row.queue}»`);
      continue;
    }
    const streetName = String(row.street ?? '').trim();
    const housePattern = String(row.housePattern ?? '*').trim() || '*';
    values.push({
      region: row.region,
      settlementName: String(row.settlement).trim(),
      settlementNormalized,
      streetName,
      streetNormalized: streetName ? await normalizeAddress(streetName) : '',
      housePattern,
      queue,
      source,
    });
  }

  if (values.length === 0) {
    return { imported: 0, skipped: rows.length, reasons: [...reasons] };
  }

  const imported = await db
    .insert(addressQueues)
    .values(values)
    .onConflictDoUpdate({
      target: [addressQueues.region, addressQueues.settlementNormalized, addressQueues.streetNormalized, addressQueues.housePattern],
      set: { queue: sql`excluded.queue`, source: sql`excluded.source`, updatedAt: sql`now()` },
    })
    .returning({ id: addressQueues.id });

  return { imported: imported.length, skipped: rows.length - values.length, reasons: [...reasons] };
}

/**
 * Подтягивание привязки у провайдера «на лету» — для адресов, которых ещё нет в базе.
 *
 * Сегодня это умеет DTEK КЕМ: POST /ua/ajax (method=getHomeNum) возвращает номера домов улицы
 * вместе с их группами. Полученное СРАЗУ сохраняем в address_queues с source='dtek' и
 * отдаём пользователю — это и есть «доподка реальных данных без выдумывания».
 *
 * Провайдер может быть недоступен (сеть, WAF, капча). Тогда возвращаем пустой массив, а НЕ
 * бросаем ошибку: отсутствие привязки — законное состояние, человек увидит «привязки нет».
 */
export async function liveLookupFromProvider(input: {
  region: string;
  settlement: string;
  street?: string;
}): Promise<Array<{ housePattern: string; queue: string }>> {
  const street = String(input.street ?? '').trim();
  // Без названия улицы справочник домов у провайдера не спросить — идти «в обход» значило бы
  // опрашивать всё подряд, что и выглядит как перебор.
  if (!street) return [];

  try {
    const { DtekKemAdapter } = await import('../parsers/ukraine-providers.adapter.js');
    const adapter = new DtekKemAdapter();
    const { mappings } = await adapter.fetchStreetHousesAndOutages(street, input.settlement);

    const settlementNormalized = await normalizeAddress(input.settlement);
    const streetNormalized = await normalizeAddress(street);

    // Сверяем с тем, что спросили: провайдер может вернуть лишние строки, а молча записать
    // чужую улицу в нашу таблицу нельзя.
    const relevant: typeof mappings = [];
    for (const mapping of mappings) {
      if (canonicalQueue(mapping.queue) === '') continue;
      if ((await normalizeAddress(mapping.settlement)) !== settlementNormalized) continue;
      if ((await normalizeAddress(mapping.street)) !== streetNormalized) continue;
      relevant.push(mapping);
    }

    const rows = relevant
      .map((mapping) => ({
        // Без номера дома (houseNumber пуст) привязка действует на всю улицу.
        housePattern: String(mapping.houseNumber ?? '').trim() || '*',
        queue: canonicalQueue(mapping.queue),
      }));

    if (rows.length === 0) return [];

    // Сохраняем найденное: повторный запрос того же адреса больше не пойдёт к провайдеру.
    await importAddressQueuesBatch(
      rows.map((row) => ({
        region: input.region,
        settlement: input.settlement,
        street,
        housePattern: row.housePattern,
        queue: row.queue,
      })),
      'dtek',
    );

    return rows;
  } catch {
    // Провайдер недоступен — ожидаемая ситуация, а не сбой поиска.
    return [];
  }
}

