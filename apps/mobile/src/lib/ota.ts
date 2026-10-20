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

/** Метаданные OTA лежат рядом с APK на Pages: не требуют деплоя воркера. */
const OTA_BASE = process.env.EXPO_PUBLIC_OTA_BASE_URL ?? 'https://svitlo-ua-4ze.pages.dev/ota';

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
  if (!info.exists) return;

  // Старые meta.json (до появления downloadedAt) не могут быть скачаны в этой сессии —
  // считаем их применёнными, иначе баннер не погаснет никогда.
  const downloadedAt = typeof meta.downloadedAt === 'number' ? meta.downloadedAt : 0;
  if (downloadedAt > LAUNCH_AT) return;

  try {
    const applied: AppliedMeta = {
      version: meta.version,
      sha256: meta.sha256,
      appliedAt: new Date().toISOString(),
    };
    await FileSystem.writeAsStringAsync(APPLIED_PATH, JSON.stringify(applied));
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

function base64ToBytes(base64: string): Uint8Array {
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
 * Проверяет, есть ли новый JS-бандл, и скачивает его.
 * Возвращает версию, если бандл готов к применению при следующем запуске.
 */
type OtaBundleInfo = NonNullable<AppVersionInfo['jsBundle']>;

export async function downloadOtaBundle(info: OtaBundleInfo | null | undefined): Promise<string | null> {
  const bundle = info;
  if (!bundle?.url) return null;

  const applied = await readApplied();
  if (applied?.sha256 === bundle.sha256) return null;

  const meta = await readMeta();
  if (meta?.sha256 === bundle.sha256) {
    const existing = await FileSystem.getInfoAsync(BUNDLE_PATH);
    // Тот же файл уже лежит и ждёт перезапуска — баннер уместен, но применённый
    // (подтверждённый) бандл повторно предлагать нельзя.
    if (existing.exists) return meta.version;
  }

  try {
    await FileSystem.makeDirectoryAsync(OTA_DIR, { intermediates: true });
    await FileSystem.deleteAsync(TMP_GZ_PATH, { idempotent: true });
    const downloaded = await FileSystem.downloadAsync(bundle.url, TMP_GZ_PATH);
    if (downloaded.status !== 200) return null;

    const base64 = await FileSystem.readAsStringAsync(TMP_GZ_PATH, { encoding: FileSystem.EncodingType.Base64 });
    const gzBytes = base64ToBytes(base64);

    // Хэш проверяем ДО распаковки: битый/подменённый файл не должен дойти до загрузчика.
    const digest = sha256(gzBytes);
    if (digest !== bundle.sha256) return null;

    const rawBundle = gunzipSync(gzBytes);
    if (rawBundle.length < 100_000) return null;

    // Атомарная замена: пишем во временный файл и переносим, чтобы обрыв записи не оставил
    // половинчатый бандл.
    await FileSystem.deleteAsync(TMP_BUNDLE_PATH, { idempotent: true });
    await FileSystem.writeAsStringAsync(TMP_BUNDLE_PATH, bytesToBase64(rawBundle), {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.deleteAsync(BUNDLE_PATH, { idempotent: true });
    await FileSystem.moveAsync({ from: TMP_BUNDLE_PATH, to: BUNDLE_PATH });

    const nextMeta: OtaMeta = {
      version: bundle.version,
      sha256: bundle.sha256,
      sizeBytes: bundle.sizeBytes,
      downloadedAt: Date.now(),
    };
    await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(nextMeta));
    await FileSystem.deleteAsync(TMP_GZ_PATH, { idempotent: true });
    return bundle.version;
  } catch {
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
  try {
    const response = await fetch(`${OTA_BASE}/version.json`, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const data = (await response.json()) as { jsBundle?: AppVersionInfo['jsBundle'] };
    const info = data.jsBundle;
    if (!info?.url || !info.sha256 || !info.version) return null;
    return info;
  } catch {
    return null;
  }
}
