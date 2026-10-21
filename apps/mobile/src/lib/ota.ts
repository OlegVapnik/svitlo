import * as FileSystem from 'expo-file-system/legacy';
import { gunzipSync } from 'fflate';
import { sha256 } from 'js-sha256';

import type { AppVersionInfo } from '@svitlo/shared';

/**
 * Тихий OTA JS-бандла — второй контур обновления.
 *
 * Первый контур (APK) остаётся для изменений нативного кода. JS-правки (текст, вёрстка,
 * экраны) приезжают сжатым бандлом ~400 КБ с Cloudflare Pages: приложение проверяет хэш
 * из `/api/v1/version`, качает `.gz` в фоне, распаковывает и кладёт `index.android.bundle`
 * в files/ota. Нативный загрузчик (OtaBundle.kt) подхватит его при следующем запуске.
 *
 * Защита от «кирпича»: нативный загрузчик на старте пишет маркер `.booted`, а JS удаляет его,
 * только когда приложение успешно смонтировалось. Если маркер остался — прошлый бандл не
 * запустился, и нативный слой откатывается к вшитому бандлу из APK.
 */
const OTA_DIR = `${FileSystem.documentDirectory ?? ''}ota/`;
const BUNDLE_PATH = `${OTA_DIR}index.android.bundle`;
const TMP_BUNDLE_PATH = `${OTA_DIR}index.android.bundle.tmp`;
const TMP_GZ_PATH = `${OTA_DIR}bundle.gz.tmp`;
const META_PATH = `${OTA_DIR}meta.json`;
const APPLIED_PATH = `${OTA_DIR}applied.json`;
const BOOT_MARKER = `${OTA_DIR}.booted`;

/**
 * Время старта процесса. Если `meta.json` записан раньше этого момента, значит бандл уже
 * лежал на диске к запуску — нативный загрузчик применил его, и баннер «перезапустіть»
 * показывать больше не нужно. Скачивание в текущей сессии всегда новее этой отметки.
 */
const LAUNCH_AT = Date.now();

/**
 * Источники манифеста OTA.
 * Первичный канал — GitHub (OlegVapnik/svitlo), резервный fallback — Cloudflare Pages.
 */
const OTA_SOURCES = [
  'https://raw.githubusercontent.com/OlegVapnik/svitlo/main/ota',
  'https://svitlo-ua-4ze.pages.dev/ota',
];
const OTA_BASE = process.env.EXPO_PUBLIC_OTA_BASE_URL ?? OTA_SOURCES[0];

export interface OtaMeta {
  version: string;
  sha256: string;
  sizeBytes: number;
  /** Когда бандл скачали. Нет у записей, созданных до появления поля. */
  downloadedAt?: number;
}

interface AppliedMeta {
  version: string;
  sha256: string;
  appliedAt: string;
  /**
   * `true` — бандл был скачан, но не поднялся, и нативный загрузчик откатился к вшитому.
   * Такой SHA больше не предлагаем: иначе приложение качало бы его заново и падало через
   * один запуск, пока манифест на CDN не обновят.
   */
  failed?: boolean;
}

/**
 * Диагностика в logcat (`adb logcat -s ReactNativeJS:V`).
 *
 * Тихий OTA по определению невидим в интерфейсе, а в поле «обновление не приехало» иначе
 * приходится угадывать: нет манифеста, не сошёлся хэш, битый gzip или откат по маркеру.
 * Строки короткие и без ПД — их безопасно оставлять в релизе.
 */
function log(message: string, ...rest: unknown[]): void {
  console.log(`[ota] ${message}`, ...rest);
}

/** Первые 8 символов SHA — чтобы сравнивать бандлы в логах, не засоряя вывод. */
function shortSha(sha256: string): string {
  return sha256.slice(0, 8);
}

async function readMeta(): Promise<OtaMeta | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(META_PATH);
    const parsed = JSON.parse(raw) as OtaMeta;
    return parsed?.version ? parsed : null;
  } catch {
    return null;
  }
}

async function readApplied(): Promise<AppliedMeta | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(APPLIED_PATH);
    const parsed = JSON.parse(raw) as AppliedMeta;
    return parsed?.sha256 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Подтверждение удачного старта.
 *
 * Кроме снятия маркера отката, фиксируем SHA уже применённого бандла. Без этой записи
 * `pendingOtaVersion()` продолжал видеть `meta.json` и вечно показывал баннер «JS-оновлення
 * завантажено, перезапустіть застосунок» — даже после десятка перезапусков.
 *
 * Запись делаем только если бандл лежал на диске ДО старта процесса: файл, скачанный в этой
 * сессии, ещё не применён и должен дождаться следующего запуска.
 */
export async function confirmOtaBoot(): Promise<void> {
  try {
    await FileSystem.deleteAsync(BOOT_MARKER, { idempotent: true });
  } catch {
    /* маркера нет — обычный запуск */
  }

  const meta = await readMeta();
  if (!meta) return;
  const info = await FileSystem.getInfoAsync(BUNDLE_PATH);
  if (!info.exists) {
    // `meta.json` есть, а бандла нет — значит нативный загрузчик удалил его после
    // неудачного старта (оставил маркер `.booted`). Помечаем SHA как непригодный и убираем
    // метаданные: без этого `downloadOtaBundle` снова скачал бы тот же файл, и приложение
    // падало бы через один запуск, пока манифест на CDN не заменят.
    log('відкат до вшитого бандла, sha позначено як невдалий', shortSha(meta.sha256));
    try {
      const rejected: AppliedMeta = {
        version: meta.version,
        sha256: meta.sha256,
        appliedAt: new Date().toISOString(),
        failed: true,
      };
      await FileSystem.writeAsStringAsync(APPLIED_PATH, JSON.stringify(rejected));
      await FileSystem.deleteAsync(META_PATH, { idempotent: true });
    } catch {
      /* не смогли записать — откат всё равно уже случился */
    }
    return;
  }

  // Старые meta.json (до появления downloadedAt) не могут быть скачаны в этой сессии —
  // считаем их применёнными, иначе баннер не погаснет никогда.
  const downloadedAt = typeof meta.downloadedAt === 'number' ? meta.downloadedAt : 0;
  if (downloadedAt > LAUNCH_AT) return;

  // Уже подтверждённый бандл подтверждаем один раз: без этого `applied.json` переписывался
  // на каждом запуске (лишняя запись на диск и строка в логе каждые полминуты).
  const confirmed = await readApplied();
  if (confirmed?.sha256 === meta.sha256 && !confirmed.failed) return;

  try {
    const applied: AppliedMeta = {
      version: meta.version,
      sha256: meta.sha256,
      appliedAt: new Date().toISOString(),
    };
    await FileSystem.writeAsStringAsync(APPLIED_PATH, JSON.stringify(applied));
    log('OTA-бандл підтверджено', meta.version, shortSha(meta.sha256));
  } catch {
    /* не смогли записать — баннер просто появится ещё раз */
  }
}

/** Есть ли уже скачанный бандл, ждущий применения. */
export async function pendingOtaVersion(): Promise<string | null> {
  const meta = await readMeta();
  if (!meta) return null;
  const info = await FileSystem.getInfoAsync(BUNDLE_PATH);
  if (!info.exists) return null;
  const applied = await readApplied();
  if (applied?.sha256 === meta.sha256) return null;
  return meta.version;
}

/** Кодирование байтов в base64 без Buffer/atob (Hermes их не гарантирует). */
function bytesToBase64(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    output += table[first >> 2];
    output += table[((first & 3) << 4) | (second >> 4)];
    output += index + 1 < bytes.length ? table[((second & 15) << 2) | (third >> 6)] : '=';
    output += index + 2 < bytes.length ? table[third & 63] : '=';
  }
  return output;
}

/** Экспорт для `lib/updates.ts`: SHA-256 APK считается по тем же байтам, что и бандла. */
export function base64ToBytes(base64: string): Uint8Array {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/]/gu, '');
  const length = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(length);
  let bits = 0;
  let bitCount = 0;
  let index = 0;
  for (const char of clean) {
    const value = table.indexOf(char);
    if (value < 0) continue;
    bits = (bits << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[index++] = (bits >> bitCount) & 0xff;
    }
  }
  return bytes.subarray(0, index);
}

/**
 * Догружает ресурсы бандла (шрифт иконок из `raw`, картинки из `drawable-*`) рядом с бандлом
 * в `files/ota/`.
 *
 * Зачем: из APK RN берёт ассеты по имени Android-ресурса, а из файла на диске — по пути
 * «каталог бандла / подкаталог drawable или raw / имя файла». Без этих файлов приложение
 * на OTA-бандле рисуется без иконок в таб-баре и шапке, хотя сам код работает.
 *
 * Ошибка загрузки не отменяет обновление: потерять иконки хуже, чем не обновиться, но
 * и блокировать исправление логики из-за одной картинки нельзя — пишем в лог и идём дальше.
 */
async function syncOtaAssets(assets: OtaBundleInfo['assets']): Promise<void> {
  if (!assets?.length) return;
  let downloaded = 0;
  for (const asset of assets) {
    if (!asset?.path || !asset.url) continue;
    // `..` в пути недопустим: манифест приходит по сети, а пишем мы в приватный каталог
    // приложения — подстановка выхода из него была бы записью в чужие файлы.
    if (asset.path.includes('..')) continue;
    const target = `${OTA_DIR}${asset.path}`;
    try {
      const info = await FileSystem.getInfoAsync(target);
      if (info.exists && (!asset.sizeBytes || info.size === asset.sizeBytes)) continue;
      const dir = target.slice(0, target.lastIndexOf('/') + 1);
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const result = await FileSystem.downloadAsync(asset.url, target);
      if (result.status === 200) downloaded += 1;
    } catch (error) {
      log('ресурс не завантажено', asset.path, error instanceof Error ? error.message : String(error));
    }
  }
  log('ресурси оновлено', `${downloaded}/${assets.length}`);
}

/**
 * Проверяет, есть ли новый JS-бандл, и скачивает его.
 * Возвращает версию, если бандл готов к применению при следующем запуске.
 */
type OtaBundleInfo = NonNullable<AppVersionInfo['jsBundle']>;

export async function downloadOtaBundle(
  info: OtaBundleInfo | null | undefined,
  onProgress?: (fraction: number) => void,
): Promise<string | null> {
  const bundle = info;
  if (!bundle?.url) {
    log('манифест без адреси бандла');
    return null;
  }

  const applied = await readApplied();
  if (applied?.sha256 === bundle.sha256) {
    log(applied.failed ? 'sha раніше не піднявся, пропускаю' : 'вже застосовано', shortSha(bundle.sha256));
    // Бандл применён, но ресурсы могли не докачаться в прошлый раз (сеть пропала, процесс
    // убили). Проверка дешёвая — только размеры файлов, без сети, пока всё на месте.
    if (!applied.failed) await syncOtaAssets(bundle.assets);
    return null;
  }

  const meta = await readMeta();
  if (meta?.sha256 === bundle.sha256) {
    const existing = await FileSystem.getInfoAsync(BUNDLE_PATH);
    // Тот же файл уже лежит и ждёт перезапуска — баннер уместен, но применённый
    // (подтверждённый) бандл повторно предлагать нельзя.
    if (existing.exists) {
      log('бандл уже завантажено, чекає перезапуску', shortSha(bundle.sha256));
      // Ресурсы могли не докачаться в прошлый раз (сеть пропала на середине) — повторяем
      // здесь, пока ожидание перезапуска ещё уместно.
      await syncOtaAssets(bundle.assets);
      onProgress?.(1);
      return meta.version;
    }
  }

  try {
    await FileSystem.makeDirectoryAsync(OTA_DIR, { intermediates: true });
    await FileSystem.deleteAsync(TMP_GZ_PATH, { idempotent: true });
    log('завантажую', bundle.version, shortSha(bundle.sha256), `${bundle.sizeBytes} B`);
    // Resumable вместо `downloadAsync`: тот же протокол, но с колбэком прогресса — капсула
    // может честно показать «Завантаження 12 з 34 МБ», а не молча висеть.
    const resumable = FileSystem.createDownloadResumable(bundle.url, TMP_GZ_PATH, {}, (data) => {
      const total = data.totalBytesExpectedToWrite > 0 ? data.totalBytesExpectedToWrite : bundle.sizeBytes;
      if (total <= 0) return;
      onProgress?.(Math.min(0.99, data.totalBytesWritten / total));
    });
    const downloaded = await resumable.downloadAsync();
    if (!downloaded || downloaded.status !== 200) {
      log('сервер віддав', String(downloaded?.status ?? 'null'));
      return null;
    }

    const base64 = await FileSystem.readAsStringAsync(TMP_GZ_PATH, { encoding: FileSystem.EncodingType.Base64 });
    const gzBytes = base64ToBytes(base64);

    // Хэш проверяем ДО распаковки: битый/подменённый файл не должен дойти до загрузчика.
    const digest = sha256(gzBytes);
    if (digest !== bundle.sha256) {
      log('хэш не збігся', shortSha(digest), '≠', shortSha(bundle.sha256));
      return null;
    }

    // Обрезанный (truncated) `.gz` проходит проверку хэша, если манифест собран из того же
    // битого файла, поэтому распаковка — отдельный рубеж: её провал не должен ничего писать.
    let rawBundle: Uint8Array;
    try {
      rawBundle = gunzipSync(gzBytes);
    } catch (error) {
      log('gzip не розпакувався', error instanceof Error ? error.message : String(error));
      return null;
    }
    if (rawBundle.length < 100_000) {
      log('бандл замалий', `${rawBundle.length} B`);
      return null;
    }

    // Атомарная замена: пишем во временный файл и переносим, чтобы обрыв записи не оставил
    // половинчатый бандл.
    await FileSystem.deleteAsync(TMP_BUNDLE_PATH, { idempotent: true });
    await FileSystem.writeAsStringAsync(TMP_BUNDLE_PATH, bytesToBase64(rawBundle), {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.deleteAsync(BUNDLE_PATH, { idempotent: true });
    await FileSystem.moveAsync({ from: TMP_BUNDLE_PATH, to: BUNDLE_PATH });

    // Ресурсы кладём до записи meta: если приложение поднимется с новым бандлом, иконки
    // должны быть уже на месте, иначе первый запуск покажет интерфейс без глифов.
    await syncOtaAssets(bundle.assets);

    const nextMeta: OtaMeta = {
      version: bundle.version,
      sha256: bundle.sha256,
      sizeBytes: bundle.sizeBytes,
      downloadedAt: Date.now(),
    };
    await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(nextMeta));
    await FileSystem.deleteAsync(TMP_GZ_PATH, { idempotent: true });
    log('готово до перезапуску', bundle.version, `${rawBundle.length} B`);
    return bundle.version;
  } catch (error) {
    log('помилка завантаження', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Служебный экспорт для отладки: путь к загруженному бандлу. */
export const OTA_PATHS = { dir: OTA_DIR, bundle: BUNDLE_PATH, meta: META_PATH } as const;



/**
 * Манифест OTA с Pages (`/ota/version.json`).
 *
 * Отдельный файл, а не поле в `/api/v1/version`: JS-бандл можно публиковать десятки раз в день,
 * не трогая воркер и D1. Если манифеста нет — тихо живём на вшитом бандле.
 */
export async function fetchOtaBundleInfo(): Promise<OtaBundleInfo | null> {
  const sources = [OTA_BASE, ...OTA_SOURCES.filter((s) => s !== OTA_BASE)];
  const cacheBuster = `?t=${Date.now()}`;
  for (const base of sources) {
    try {
      const response = await fetch(`${base}/version.json${cacheBuster}`, {
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { jsBundle?: AppVersionInfo['jsBundle'] };
      const info = data.jsBundle;
      if (info?.url && info.sha256 && info.version) {
        return info;
      }
    } catch {
      // Пробуем следующий источник (GitHub -> Pages fallback)
    }
  }
  return null;
}
