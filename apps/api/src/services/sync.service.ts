import type {
  GroupOutageSummary,
  QueueSummary,
  SyncBundle,
  SyncRegionSchedules,
  SyncSettlement,
} from '@svitlo/shared';
import { computeSyncEtag, canonicalRegionCpu } from '@svitlo/shared';
import { queryNews } from './news/news-query.service.js';
import { listQueues } from './queues.service.js';
import { listRegions } from './regions.service.js';
import { listRegionSettlements } from './settlements.service.js';
import { buildStatusPayload } from './status.service.js';
import { listUpcomingGroupOutages } from './upcoming-outages.service.js';

/**
 * Київська дата `YYYY-MM-DD` для моменту `now`.
 *
 * Окремо, а не через `toISOString().slice(0, 10)`: до 03:00 за київським часом UTC-дата ще вчорашня,
 * і нічний запит приносив би графік за минулу добу.
 */
function kyivDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Скільки діб графіка класти в пакет: сьогодні й завтра — більше телефону не потрібно офлайн. */
export const SYNC_SCHEDULE_DAYS = 2;

/** Скільки новин класти в пакет: вистачає, щоб офлайн-стрічка не виглядала порожньою. */
export const SYNC_NEWS_LIMIT = 20;

/**
 * Збирає пакет `/api/v1/sync`: усе, що потрібне телефону, щоб працювати без мережі.
 *
 * Чому один ендпоінт, а не «хай клієнт сам смикає шість». У мобільної мережі (ліфт, метро,
 * село) дорогий не розмір відповіді, а кожне встановлення з'єднання й кожен холодний старт на
 * сервері: шість запитів давали шість шансів не дійти до кінця, і офлайн-кеш залишався наполовину
 * наповненим. Один пакет або приїжджає цілком, або не приїжджає взагалі — і тоді на екрані
 * чесно видно дату попереднього збереження.
 *
 * `days` обмежений: за три-чотири доби пакет важить більше, ніж користі приносить, а розкладу
 * далі ніж на добу наперед у ГПВ не буває.
 */
export async function buildSyncBundle(
  region: string,
  options: { now?: Date; days?: number; requestedRegion?: string } = {},
): Promise<SyncBundle> {
  const now = options.now ?? new Date();
  const days = Math.max(1, Math.min(options.days ?? SYNC_SCHEDULE_DAYS, 7));
  const days7 = Array.from({ length: days }, (_, index) => {
    const base = Date.parse(`${kyivDate(now)}T00:00:00Z`) + index * 86_400_000;
    return new Date(base).toISOString().slice(0, 10);
  });

  // Паралельно: блоки незалежні, і послідовний виклик додавав би до відповіді суму затримок
  // замість максимуму.
  //
  // `catch` лише на графіку, новинах, чергах і НП — свідомо. Статус мережі й каталог областей
  // обов'язкові: без них пакет безглуздий, і краще чесний 500. А от збій збору новин, порожні
  // слоти чи зламаний довідник НП не привід не віддати телефону графік — офлайн-кеш із частковим
  // пакетом корисніший за порожній.
  const [status, regions, buckets, news, queues, settlementList] = await Promise.all([
    buildStatusPayload(region, now),
    listRegions(),
    listUpcomingGroupOutages(region, days, now).catch((): GroupOutageSummary[] => []),
    queryNews({ region, limit: SYNC_NEWS_LIMIT }).catch(() => null),
    listQueues(region).catch((): QueueSummary[] => []),
    listRegionSettlements(region).catch((): { items: SyncSettlement[]; total: number } => ({ items: [], total: 0 })),
  ]);

  // Графік кладемо під УСІ коди області, які міг надіслати клієнт: канонічний (`kyiv-city`,
  // `kyivska-oblast` — те, що лежить у каталозі та в посиланні) і ключ фіда (`kyiv`,
  // `kiivska-oblast` — те, що залишилось у localStorage і закладках). Клієнт читає
  // `schedulesByRegion[region]` рівно тим кодом, який сам надіслав, тож один ключ означав би
  // «даних графіка немає» при живому графіку.
  const schedulesByRegion: Record<string, SyncRegionSchedules> = {};
  const scheduleKeys = new Set<string>([
    region,
    String(options.requestedRegion ?? '').trim().toLowerCase(),
    canonicalRegionCpu(options.requestedRegion ?? region),
  ]);
  for (const key of scheduleKeys) {
    if (key) schedulesByRegion[key] = { days: days7, buckets };
  }

  const body: Omit<SyncBundle, 'syncedAt' | 'etag'> = {
    region,
    status,
    regions,
    queues,
    schedulesByRegion,
    settlements: settlementList.items,
    settlementsTotal: settlementList.total,
    news: news?.data ?? [],
    // Контакти обленерго прибрані з проєкту (міграція 0018) — поле лишається порожнім, щоб
    // контракт не змінювався, а клієнт не падав на `undefined`.
    contacts: [],
  };

  return {
    syncedAt: now.toISOString(),
    etag: computeSyncEtag(etagSource(body)),
    ...body,
  };
}

/**
 * Проекція пакета, від якої рахується ETag.
 *
 * Прибираємо два поля, які змінюються від самого факту запиту, а не від даних:
 *   - `syncedAt` — час збору пакета; клієнт зберігає його локально, у хеші він зайвий;
 *   - `status.nextAttemptAt` — розклад наступного опитування джерела (`now + інтервал`), тобто
 *     також похідна від поточного часу.
 *
 * Без цього ETag змінювався б на кожен запит (перевірено вживу: два послідовні виклики давали
 * різні хеші), `If-None-Match` ніколи не збігався б, і 304 не настав би ніколи — заголовок був би
 * декоративним, а пакет щоразу їхав би мережею повністю.
 */
function etagSource(body: Omit<SyncBundle, 'syncedAt' | 'etag'>): unknown {
  const { nextAttemptAt: _scheduleOnly, ...status } = body.status;
  return { ...body, status };
}
