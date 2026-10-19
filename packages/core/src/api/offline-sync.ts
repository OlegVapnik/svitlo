/**
 * Офлайн-пакет застосунку: локальне сховище, гідратація кеша й фонова синхронізація.
 *
 * Зачем это поверх `offline-cache.ts` (кеш відповідей по URL) і `offline-region-schedules.ts`
 * (знімок графіків області): обидва наповнюються лише після того, як людина сама відкрила
 * відповідний екран. У селі без зв'язку телефон показував порожнечу саме там, куди ще не
 * заходили: «Мої черги» — пусто, пошук адреси — пусто, блок новин — пусто.
 *
 * Пакет `GET /api/v1/sync` приходить ОДНИМ запитом і містить усе потрібне для старту: статус
 * мережі, каталог областей, групи області, графіки на сьогодні й завтра, населені пункти та
 * останні новини. У мобільній мережі важлива не швидкість окремого запиту, а їх кількість.
 *
 * Как это работает:
 *   1. `hydrateOfflineStartup()` (main.tsx, до першого рендера) кладёт данные с диска в кеш
 *      TanStack Query — первый кадр в офлайне уже с графиком;
 *   2. `syncNow(region)` ходит в сеть с `If-None-Match` и обновляет и диск, и кеш;
 *   3. хук `useOfflineSync` вызывает (2) при старте, возврате во вкладку, появлении связи и
 *      раз в 15 минут.
 *
 * Чего здесь сознательно НЕ делается: пакет не «достраивается» выдуманными данными и одна
 * область не подменяется другой. Нет пакета области — нет и офлайн-данных для неё, экран честно
 * скажет, что данных нет. Нет сети и нет пакета — показываем пусто, а не вчерашний график
 * соседней области.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { SyncBundle, SyncSettlement } from '@svitlo/shared';
import { storage } from '../storage';
import { ApiError, api } from './client';
import { queryClient } from './query-client';
import { writeCache } from './offline-cache';
import { writeRegionScheduleSnapshot } from './offline-region-schedules';
import { rankSettlements } from '../lib/settlement-search';
import { canonicalQueueCode, canonicalQueueListForRegion } from '../lib/queue';
import { getStoredRegion, isRegionCpu, normalizeRegionCpu, type RegionSummary } from '../lib/region';

/** Ключ записи пакета области. Версия в имени — чтобы запись старого формата не выдавала себя за новую. */
const BUNDLE_PREFIX = 'svitlo:offline-bundle:v1:';
/** Каталог областей один на всё приложение (не на область), поэтому лежит отдельной записью. */
const CATALOG_KEY = 'svitlo:offline-catalog:v1';

/**
 * Потолок размера записи пакета. Сейчас пакет области занимает ~170 КБ (в основном населённые
 * пункты), в localStorage на телефоне обычно доступно 5–10 МБ на origin. Ограничение нужно,
 * чтобы один пакет не вытеснил закладки и остальные кеши; при превышении просто не сохраняем.
 */
const MAX_BUNDLE_CHARS = 900_000;

/** Как часто проверяем сервер, пока приложение открыто. Оператор обновляет график раз в ~30 минут. */
export const SYNC_INTERVAL_MS = 15 * 60_000;

/** Дней графика в пакете — ровно столько же, сколько просит главная (`useUpcomingGroupOutages(region, 2)`). */
const SCHEDULE_DAYS = 2;
/**
 * Сколько новин кладёт в пакет сервер (`SYNC_NEWS_LIMIT` в services/sync.service.ts и такой же
 * лимит в cf-worker). Держим числом, чтобы в кеш записи попадали под ключом, соответствующим
 * запросу пакета, а не под произвольным.
 */
const BUNDLE_NEWS_LIMIT = 20;
/** Лимит ленты на странице новостей (`useNews({ limit: 50 })` в NewsPage) — для её ключа кеша. */
const NEWS_LIMIT = 50;

/** Запись пакета на диске. */
export interface OfflineBundleRecord {
  /** Когда запись сделана на этом устройстве (ISO). */
  savedAt: string;
  /** Время сборки пакета на сервере (ISO) — настоящий возраст данных, который видит интерфейс. */
  syncedAt: string;
  /** ETag содержимого: уходит в `If-None-Match` при следующей синхронизации. */
  etag: string;
  bundle: SyncBundle;
}

interface CatalogRecord {
  savedAt: string;
  regions: RegionSummary[];
}

/** Ключ строго по имени области, без подстановки области по умолчанию: иначе можно прочитать чужой пакет. */
function bundleKey(region: string): string {
  return BUNDLE_PREFIX + String(region ?? '').trim().toLowerCase();
}

/**
 * Области, для которых пакет с диска уже разложен по кешу в этой сессии.
 *
 * Нужен, чтобы гидратация не повторялась на каждом монтировании экрана: иначе кеш снова
 * накрывался бы данными с диска поверх уже обновлённых сетью, и свежий статус откатывался бы к
 * состоянию часовой давности.
 */
const hydratedRegions = new Set<string>();

/**
 * Читает пакет области. `null` — записи нет, она повреждена или сделана другой версией схемы.
 *
 * Наличие `regions` и `syncedAt` проверяем: без них гидратация собрала бы кеш из мусора, и
 * интерфейс показал бы пустые списки как «данные области».
 */
export function readOfflineBundle(region: string): OfflineBundleRecord | null {
  const store = storage;
  if (!region) return null;
  try {
    const raw = store.getItem(bundleKey(region));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineBundleRecord;
    const bundle = parsed?.bundle;
    if (!bundle || typeof bundle.syncedAt !== 'string' || !Array.isArray(bundle.regions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Каталог областей: он нужен в офлайне до первой синхронизации области (выбор области в шапке). */
function readCatalog(): CatalogRecord | null {
  const store = storage;
  try {
    const raw = store.getItem(CATALOG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogRecord;
    return Array.isArray(parsed?.regions) ? parsed : null;
  } catch {
    return null;
  }
}

function saveCatalog(regions: RegionSummary[]): void {
  const store = storage;
  if (!Array.isArray(regions) || regions.length === 0) return;
  try {
    const record: CatalogRecord = { savedAt: new Date().toISOString(), regions: canonicalizeRegions(regions) };
    store.setItem(CATALOG_KEY, JSON.stringify(record));
  } catch {
    // Квота исчерпана — не настаиваем: каталог придёт по сети.
  }
}

/**
 * Приводит коды групп области к канонической форме (Київ: «3» → «3/1»).
 *
 * Офлайн-пакет формирует сервер, и у Києва живой источник может отдать плоские «1…6», а зеркало —
 * «1/1…60/1». Без сведения к одной форме выбранная группа не находила свои интервалы ни в кеше, ни
 * в снимке. Применяем и при записи на диск, и при гидратации — чтобы старая запись тоже читалась.
 */
function canonicalizeRegions(regions: RegionSummary[]): RegionSummary[] {
  return regions.map((region) => ({
    ...region,
    queues: canonicalQueueListForRegion(region.cpu, region.queues ?? []),
  }));
}

/** Приводит `queue` у записей области (группы, бакеты) к канонической форме области. */
function canonicalizeQueueField<T extends { queue: string }>(region: string, items: readonly T[]): T[] {
  return items.map((item) => ({ ...item, queue: canonicalQueueCode(region, item.queue) }));
}

/**
 * Сводит каталог из пакета `/sync` с уже загруженным каталогом `/regions`.
 *
 * Зачем это здесь, а не в экранах. `/regions` — справочник областей для RegionPicker, а `/sync`
 * несёт собственную копию каталога внутри пакета. Это два независимых снимка: их сводки
 * (`covered`, `slots`) могут разойтись, и тогда одна и та же область показывает «Є графік» или
 * «Немає даних» в зависимости от того, какой ответ пришёл последним. Раньше `applyBundle` просто
 * перезаписывал кеш `['regions']` каталогом из пакета — отсюда и мерцание меток.
 *
 * Правило: каталог `/regions` авторитетнее для уже известных областей, пакет только добивает
 * отсутствующие (холодный старт или офлайн, где `/regions` ещё не приходил). Так данные одинаковы
 * на вебе и в приложении, без дублирования «склейки» в двух UI.
 */
export function mergeRegionCatalog(
  existing: readonly RegionSummary[] | undefined | null,
  incoming: readonly RegionSummary[] | undefined | null,
): RegionSummary[] {
  const merged = [...(existing ?? [])];
  const seen = new Set(merged.map((region) => region.cpu));
  for (const region of incoming ?? []) {
    if (!region?.cpu || seen.has(region.cpu)) continue;
    seen.add(region.cpu);
    merged.push(region);
  }
  return merged;
}

/** Сохраняет пакет области. `null` — не поместилось или хранилище недоступно (данные при этом не теряются). */
function saveOfflineBundle(region: string, bundle: SyncBundle): OfflineBundleRecord | null {
  const store = storage;
  if (!region || !bundle || typeof bundle.syncedAt !== 'string') return null;

  const record: OfflineBundleRecord = {
    savedAt: new Date().toISOString(),
    syncedAt: bundle.syncedAt,
    etag: typeof bundle.etag === 'string' ? bundle.etag : '',
    bundle,
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    return null;
  }
  if (serialized.length > MAX_BUNDLE_CHARS) return null;

  try {
    store.setItem(bundleKey(region), serialized);
  } catch {
    return null;
  }

  saveCatalog(bundle.regions);
  return record;
}


// ──────────────────────────────── Гидратация кеша ────────────────────────────────

/**
 * Путь эндпоинта новостей ровно в том виде, в каком его строит `api.fetchNews` (включая порядок
 * параметров). Иначе запись в офлайн-кеше по URL не совпадёт с реальным запросом, и офлайн-фолбэк
 * новостей не сработает.
 */
function newsEndpoint(params: Record<string, string>): string {
  return `/news?${new URLSearchParams(params).toString()}`;
}

/**
 * Кладёт данные пакета в кеш TanStack Query.
 *
 * `at` — время серверной сборки пакета: оно уходит в `updatedAt`, и React Query считает данные
 * свежими ровно с той секунды, когда их отдал сервер. Если подставить «сейчас», офлайн-старт с
 * вчерашним пакетом выглядел бы как «щойно оновлено» — человек сверялся бы по нему, выключат ли
 * свет, и не понял бы, что цифры вчерашние.
 */
function applyBundle(client: QueryClient, region: string, bundle: SyncBundle, at?: number): void {
  const updatedAt = at ?? Date.parse(bundle.syncedAt);
  const options = Number.isFinite(updatedAt) ? { updatedAt } : undefined;

  // Коды групп области сводим к канонической форме (Київ: «3» → «3/1»), иначе строка матрицы и
  // выбранная группа не сходились бы с интервалами пакета. Сам каталог не перезаписываем целиком:
  // `/regions` — авторитетный справочник, пакет лишь добивает области, которых там ещё нет
  // (см. `mergeRegionCatalog`).
  const cachedRegions = client.getQueryData<{ data?: RegionSummary[] }>(['regions'])?.data;
  const regions = mergeRegionCatalog(cachedRegions, canonicalizeRegions(bundle.regions));
  // Помечаем каталог устаревшим намеренно: `/regions` — авторитетный справочник, и онлайн-запрос
  // должен обновить засеянные пакетом метки. Иначе `staleTime` считал бы их свежими и оставлял
  // расхождение «Сумська/Рівненська» на экране до истечения пяти минут.
  client.setQueryData(['regions'], { data: regions }, { updatedAt: 0 });
  if (bundle.status) client.setQueryData(['status', region], { data: bundle.status }, options);
  if (Array.isArray(bundle.queues)) {
    client.setQueryData(['queues', region], { data: canonicalizeQueueField(region, bundle.queues) }, options);
  }

  const schedules = bundle.schedulesByRegion?.[region];
  if (schedules && Array.isArray(schedules.buckets)) {
    const buckets = canonicalizeQueueField(region, schedules.buckets);
    client.setQueryData(['upcomingGroupOutages', region, SCHEDULE_DAYS], { data: buckets }, options);
    // Снимок области — чтобы кнопки групп (useQueueSchedule) работали в офлайне без своего
    // запроса. Время снимка берём серверное: именно оно показывается как «дані станом на».
    writeRegionScheduleSnapshot(region, buckets, bundle.syncedAt);
  }

  if (Array.isArray(bundle.news)) {
    const news = { data: bundle.news };
    // Пакет містить останні 20 новин області. Кладём их и под тем ключом, что соответствует
    // самому запросу пакета, и под ключом страницы новостей (`limit: 50` по умолчанию):
    // в офлайне запрос не выполнить, а 20 настоящих записей — не выдумка, просто короче выдача.
    // Онлайн это на мгновение: данные считаются устаревшими через 5 минут, и сеть отдаёт все 50.
    client.setQueryData(['news', { region, limit: BUNDLE_NEWS_LIMIT }], news, options);
    client.setQueryData(['news', { region, limit: NEWS_LIMIT }], news, options);
    // Копии в офлайн-кеш по URL: они спасают сетевой путь новостей, когда связи нет вовсе —
    // fetcher отдаёт последний успешный ответ вместо пустого экрана.
    writeCache(newsEndpoint({ region, limit: String(BUNDLE_NEWS_LIMIT) }), news);
    writeCache(newsEndpoint({ region, limit: String(NEWS_LIMIT) }), news);
  }
}

/** Область, с которой начинаем работу: из адреса (как RegionContext), иначе из хранилища. */
export function startupRegion(): string {
  if (typeof window !== 'undefined') {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('region');
      if (isRegionCpu(fromUrl)) return normalizeRegionCpu(fromUrl);
    } catch {
      // Некорректный адрес — считаем, что области в нём нет.
    }
  }
  return getStoredRegion();
}

/**
 * Гидратация одной области из записи на диске: наполняет кеш и состояние синхронизации.
 * Возвращает запись, если она была (нет записи — нечего показывать, и это честный пустой экран).
 */
export function hydrateStoredRegion(region: string, client: QueryClient = queryClient): OfflineBundleRecord | null {
  const record = readOfflineBundle(region);
  if (!record) return null;
  hydratedRegions.add(region);
  applyBundle(client, region, record.bundle, Date.parse(record.syncedAt));
  setSyncState({
    phase: 'stored',
    region,
    syncedAt: record.syncedAt,
    settlements: record.bundle.settlements?.length ?? 0,
  });
  return record;
}

/** Раскладывался ли пакет этой области по кешу в текущей сессии (см. `hydratedRegions`). */
export function isRegionHydrated(region: string): boolean {
  return hydratedRegions.has(region);
}

/**
 * Гидратация при старте приложения (main.tsx, до первого рендера).
 *
 * Каталог областей берём отдельной записью, а пакет — только той области, с которой начинаем:
 * держать в памяти кеши всех областей незачем, область переключается уже после старта
 * (см. `useOfflineSync`).
 */
export function hydrateOfflineStartup(): string {
  const region = startupRegion();
  if (!hydrateStoredRegion(region)) {
    const catalog = readCatalog();
    // Записи на диске могли быть сделаны до введения канонизации — прогоняем и их. Каталог с диска
    // тоже не считается свежим: при наличии сети его должен заменить авторитетный `/regions`.
    if (catalog) queryClient.setQueryData(['regions'], { data: canonicalizeRegions(catalog.regions) }, { updatedAt: 0 });
    setSyncState({ phase: 'idle', region, syncedAt: null, settlements: 0 });
  }
  return region;
}


// ────────────────────────────── Стан синхронізації ──────────────────────────────

/** Фаза синхронизации: от неё зависит, что показывает индикатор в шапке. */
export type SyncPhase =
  /** Данных области нет вообще: ни на диске, ни с сервера. */
  | 'idle'
  /** Идёт запрос к серверу. */
  | 'syncing'
  /** Сервер подтвердил пакет в этой сессии (в том числе ответом 304 — «не изменился»). */
  | 'fresh'
  /** Пакет есть на диске, но сервер в этой сессии его ещё не подтверждал. */
  | 'stored'
  /** Связи нет или сервер не ответил: работаем на данных с диска. */
  | 'offline';

export interface SyncState {
  phase: SyncPhase;
  /** Область, к которой относится состояние. */
  region: string;
  /** Время сборки пакета на сервере (ISO) — реальный возраст данных для интерфейса. */
  syncedAt: string | null;
  /** Когда последний раз разговаривали с сервером (ISO). */
  checkedAt: string | null;
  /** Сколько населённых пунктов лежит в локальном пакете. */
  settlements: number;
  /** Текст последней ошибки — показывается в подсказке, чтобы не гадать «почему офлайн». */
  error: string | null;
}

let state: SyncState = {
  phase: 'idle',
  region: '',
  syncedAt: null,
  checkedAt: null,
  settlements: 0,
  error: null,
};
const stateListeners = new Set<() => void>();

/**
 * Текущее состояние синхронизации.
 *
 * Объект неизменяемый и меняется только при реальном событии: `useSyncExternalStore` сравнивает
 * ссылки, поэтому «на всякий случай новый объект» означал бы лишние перерисовки шапки.
 */
export function getSyncState(): SyncState {
  return state;
}

export function subscribeSyncState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

function setSyncState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const listener of stateListeners) {
    try {
      listener();
    } catch {
      // Индикатор в шапке не должен ломать синхронизацию.
    }
  }
}

/**
 * Одна синхронизация области: запрос к серверу, запись на диск, обновление кеша и состояния.
 *
 * Возвращать результат не нужно: состояние читается через `getSyncState()`, а вызывают функцию
 * таймер, обработчик возврата во вкладку и кнопка «Оновити» — всем им нужен общий результат.
 *
 * 200 с новым содержимым → пакет переписывается на диске и в кеше (phase 'fresh');
 * 304 / тот же etag      → сервер подтвердил актуальность, данные НЕ переписываем, и `syncedAt`
 *                         остаётся временем сборки прошлого пакета: подменять его временем
 *                         проверки значило бы выдавать вчерашние данные за сегодняшние;
 * нет сети / сервер молчит → на диске остаётся прошлый пакет (phase 'offline').
 */
export async function syncNow(region: string): Promise<void> {
  if (!isRegionCpu(region)) return;
  const clean = normalizeRegionCpu(region);
  const previous = readOfflineBundle(clean);
  const previousSettlements = previous?.bundle.settlements?.length ?? 0;
  const stored = {
    region: clean,
    syncedAt: previous?.syncedAt ?? null,
    settlements: previousSettlements,
  };

  // Быстрый путь: по словам системы связи нет — запрос не тратим, сразу показываем данные с диска.
  // `navigator.onLine` врёт только в одну сторону (говорит true, когда интернета нет), поэтому это
  // именно оптимизация, а не замена обработке ошибок запроса ниже.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSyncState({ ...stored, phase: previous ? 'offline' : 'idle', error: null });
    return;
  }

  setSyncState({ phase: 'syncing', region: clean, error: null });

  try {
    // `/sync` відповідає конвертом `{ data: bundle }` — як і решта маршрутів застосунку
    // (однакова форма скрізь потрібна, щоб офлайн-шар не мав окремого випадку).
    const response = (await api.fetchSync(clean, previous?.etag ?? null)) as { data?: SyncBundle } | null;
    const bundle = response?.data ?? null;
    if (!bundle || typeof bundle.syncedAt !== 'string') {
      // Ответ без пакета (прокси подменил тело, сервер отдал не то) — попытка неудачная,
      // но прошлые данные не трогаем: лучше старый график, чем пустой экран.
      setSyncState({ ...stored, phase: previous ? 'offline' : 'idle', error: 'empty-bundle' });
      return;
    }

    const changed = !previous || bundle.etag !== previous.etag;
    if (changed) {
      // Не поместилось на диск — не повод терять свежие данные: кеш обновляем в любом случае.
      saveOfflineBundle(clean, bundle);
      applyBundle(queryClient, clean, bundle);
    }

    setSyncState({
      phase: 'fresh',
      region: clean,
      syncedAt: bundle.syncedAt,
      checkedAt: new Date().toISOString(),
      settlements: bundle.settlements?.length ?? previousSettlements,
      error: null,
    });
  } catch (error) {
    const checkedAt = new Date().toISOString();
    if (error instanceof ApiError && error.status === 304) {
      // Тело не изменилось — это успех, а не ошибка: данные на диске по-прежнему верны.
      setSyncState({ ...stored, phase: 'fresh', checkedAt, error: null });
      return;
    }
    setSyncState({
      ...stored,
      phase: previous ? 'offline' : 'idle',
      checkedAt,
      error: error instanceof Error ? error.message : null,
    });
  }
}

// ────────────────────────── Локальные данные (без сети) ──────────────────────────

/**
 * Поиск населённых пунктов области по локальному пакету: подсказки в мастере адреса в офлайне.
 *
 * Нет пакета — пустой список. Не «похожие» и не «последние запомненные»: подсказать несуществующее
 * село хуже, чем не подсказать ничего, потому что дальше человек будет искать по нему график.
 */
export function searchOfflineSettlements(region: string, query: string, limit = 6): SyncSettlement[] {
  const record = readOfflineBundle(region);
  const settlements = record?.bundle.settlements;
  if (!settlements || settlements.length === 0) return [];
  return rankSettlements(settlements, query, limit) as SyncSettlement[];
}

/**
 * НП з відомими групами — для швидких чипів під полем пошуку.
 *
 * Сортуємо за кількістю груп, а не за алфавітом: у пакеті область може містити тисячі сіл, і
 * першим у списку має бути місто, де пошук адреси реально працює. Це не «головні міста» за
 * вигаданим рейтингом — тільки факти з офлайн-пакета.
 */
export function topOfflineSettlements(region: string, limit = 6): SyncSettlement[] {
  const record = readOfflineBundle(region);
  const settlements = record?.bundle.settlements;
  if (!settlements || settlements.length === 0) return [];
  return [...settlements]
    .sort((left, right) => {
      const byQueues = (right.queues?.length ?? 0) - (left.queues?.length ?? 0);
      if (byQueues !== 0) return byQueues;
      return left.name.localeCompare(right.name, 'uk');
    })
    .slice(0, Math.max(0, limit));
}

/** Сколько НП лежит на устройстве и сколько их всего знает сервер — для честной подписи в UI. */
export interface OfflineSettlementStats {
  /** Сколько записей реально сохранено на телефоне (пакет может быть урезан). */
  shown: number;
  /** Полное количество НП области по данным сервера. */
  total: number;
  syncedAt: string;
}

export function offlineSettlementStats(region: string): OfflineSettlementStats | null {
  const record = readOfflineBundle(region);
  if (!record) return null;
  const shown = record.bundle.settlements?.length ?? 0;
  const total = typeof record.bundle.settlementsTotal === 'number' ? record.bundle.settlementsTotal : shown;
  return { shown, total, syncedAt: record.syncedAt };
}
