import * as FileSystem from 'expo-file-system/legacy';
import { sha256 } from 'js-sha256';

import type { AppVersionInfo } from '@svitlo/shared';

import { base64ToBytes } from './ota';

/**
 * Полное обновление APK: скачивание с прогрессом, сверка SHA-256 и передача файла установщику.
 *
 * Второй контур (тихий OTA JS-бандла) живёт в `lib/ota.ts` и не требует ни разрешений, ни
 * системного окна. Здесь — только случаи, когда менялся нативный код: камеры, плееры, виджеты.
 *
 * SHA-256 — не формальность: `/api/v1/version` описывает ровно тот файл, что лежит на сайте.
 * Без сверки оборванная на 80 % закачка выглядела бы целой и падала на `PackageInstaller`.
 */
const UPDATE_DIR = `${FileSystem.documentDirectory ?? ''}updates/`;

/** Системный установщик пакетов: по этому MIME Android открывает «Встановити?». */
const APK_MIME = 'application/vnd.android.package-archive';
/** FLAG_GRANT_READ_URI_PERMISSION: установщик — другое приложение, файл ему надо разрешить. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

export type UpdateKind = 'ota' | 'apk';

/**
 * Сравнение версий по числовым сегментам: «2.26.10» новее «2.26.9», хотя строкой — наоборот.
 * Нечисловой хвост (`-beta.1`) отбрасывается: в проекте публикуются только `X.Y.Z`.
 */
export function compareVersions(candidate: string, current: string): number {
  const toParts = (value: string) =>
    value
      .trim()
      .replace(/^v/iu, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = toParts(candidate);
  const right = toParts(current);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(candidate: string | null | undefined, current: string): boolean {
  if (!candidate) return false;
  return compareVersions(candidate, current) > 0;
}

/** «34,1 МБ» — размер для шторки обновления, без десятых у килобайт. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit >= 2 ? value.toFixed(1).replace('.', ',') : String(Math.round(value));
  return `${rounded} ${units[unit]}`;
}


export interface ApkDownloadResult {
  uri: string;
  sha256: string;
  sizeBytes: number;
}

/** SHA-256 файла. Читаем целиком: `expo-file-system` не умеет потоковое чтение по чанкам. */
async function hashFile(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return sha256(base64ToBytes(base64));
}

export function apkPath(version: string): string {
  return `${UPDATE_DIR}svitlo-${version.replace(/[^0-9A-Za-z._-]/gu, '')}.apk`;
}

/**
 * Скачать APK и проверить его целостность.
 *
 * Возвращает `null` при любой проблеме (нет сети, размер не сошёлся, хэш не сошёлся): вызывающий
 * код обязан показать честную ошибку, а не предлагать «Застосувати» битый файл. Уже скачанный
 * и проверенный файл переиспользуется — повторный тап по кнопке не тратит 34 МБ трафика.
 */
export async function downloadApk(
  info: AppVersionInfo,
  onProgress?: (fraction: number) => void,
): Promise<ApkDownloadResult | null> {
  if (!info.apkUrl || !SHA256_PATTERN.test(info.sha256)) return null;

  const target = apkPath(info.version);
  await FileSystem.makeDirectoryAsync(UPDATE_DIR, { intermediates: true });

  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists && existing.size === info.sizeBytes) {
    const digest = await hashFile(target);
    if (digest === info.sha256) {
      onProgress?.(1);
      return { uri: target, sha256: digest, sizeBytes: existing.size };
    }
  }
  // Обрывок прошлой попытки: докачка по resumable-данным не хранится, поэтому начинаем заново.
  await FileSystem.deleteAsync(target, { idempotent: true });

  try {
    onProgress?.(0);
    const resumable = FileSystem.createDownloadResumable(
      info.apkUrl,
      target,
      {},
      (data) => {
        const total = data.totalBytesExpectedToWrite > 0 ? data.totalBytesExpectedToWrite : info.sizeBytes;
        if (total <= 0) return;
        onProgress?.(Math.min(0.99, data.totalBytesWritten / total));
      },
    );
    const downloaded = await resumable.downloadAsync();
    if (!downloaded || downloaded.status !== 200) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      return null;
    }

    const file = await FileSystem.getInfoAsync(target);
    if (!file.exists || file.size !== info.sizeBytes) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      return null;
    }

    const digest = await hashFile(target);
    if (digest !== info.sha256) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      return null;
    }

    onProgress?.(1);
    return { uri: target, sha256: digest, sizeBytes: file.size ?? info.sizeBytes };
  } catch {
    await FileSystem.deleteAsync(target, { idempotent: true });
    return null;
  }
}

/**
 * Открыть системный установщик для скачанного APK.
 *
 * `getContentUriAsync` отдаёт `content://` через FileProvider `expo-file-system`: `file://` на
 * Android 7+ приводит к `FileUriExposedException`. Пользователь всё равно увидит системное окно
 * подтверждения — обойти его нельзя и не нужно.
 *
 * Про `expo-intent-launcher`: это нативный модуль, и появился он только в APK 2.27.0. Тихий OTA
 * привозит на старую сборку лишь JS, поэтому статический `import` ронял весь бандл на старте
 * (`Cannot find native module 'ExpoIntentLauncher'`) — приложение откатывалось к вшитому бандлу,
 * и обновление не доезжало никогда. Грузим модуль по требованию и честно возвращаем
 * `unsupported`, чтобы UI не обещал установку, которой в этой сборке нет.
 */
type IntentLauncherModule = typeof import('expo-intent-launcher');

function loadIntentLauncher(): IntentLauncherModule | null {
  try {
    return require('expo-intent-launcher') as IntentLauncherModule;
  } catch {
    return null;
  }
}

/** Умеет ли эта сборка открывать системный инсталлятор (нужен APK с `expo-intent-launcher`). */
export function canInstallApk(): boolean {
  return loadIntentLauncher() !== null;
}

export type ApkInstallResult = 'opened' | 'unsupported' | 'failed';

export async function installApk(uri: string): Promise<ApkInstallResult> {
  const launcher = loadIntentLauncher();
  if (!launcher) return 'unsupported';
  try {
    const contentUri = await FileSystem.getContentUriAsync(uri);
    await launcher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: APK_MIME,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
    return 'opened';
  } catch {
    return 'failed';
  }
}

/** Есть ли уже скачанный файл — чтобы шторка открылась сразу на «Встановити». */
export async function hasDownloadedApk(info: AppVersionInfo): Promise<boolean> {
  try {
    const file = await FileSystem.getInfoAsync(apkPath(info.version));
    return file.exists && file.size === info.sizeBytes;
  } catch {
    return false;
  }
}
