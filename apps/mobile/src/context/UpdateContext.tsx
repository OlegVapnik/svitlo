import Constants from 'expo-constants';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAppVersion } from '@svitlo/core/api/queries';
import type { AppVersionInfo } from '@svitlo/shared';

import { confirmOtaBoot, downloadOtaBundle, fetchOtaBundleInfo, pendingOtaVersion } from '@/lib/ota';
import {
  apkPath,
  compareVersions,
  downloadApk,
  hasDownloadedApk,
  installApk,
  isNewerVersion,
  type UpdateKind,
} from '@/lib/updates';

/**
 * Версия, которая реально установлена на телефоне.
 *
 * Источник — нативная оболочка (`nativeAppVersion`), а не `expoConfig.version`: тихий OTA
 * привозит на диск бандл с более свежим `app.json`, и `expoConfig.version` начинает описывать
 * JS, а не APK. Без этого APK 2.27.1 с бандлом 2.27.2 считал бы себя 2.27.2 и никогда не
 * предложил бы установить новую сборку. Fallback — на случай старых сборок без поля.
 */
export const APP_VERSION: string =
  Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '0.0.0';

export type UpdatePhase = 'idle' | 'downloading' | 'verifying' | 'ready' | 'applying' | 'error';

/**
 * Ступени многоступенчатого прогресса карточки обновлений (Morphe-стиль):
 * ожидание → скачивание → сверка SHA-256 → готово к установке.
 * В отличие от `UpdatePhase` здесь нет `applying`: установка — действие поверх «ready».
 */
export type UpdateStage = 'idle' | 'downloading' | 'verifying' | 'ready' | 'error';

/** Обновление, которое ждёт пользователя: тихий JS-бандл или полный APK. */
export interface PendingUpdate {
  kind: UpdateKind;
  version: string;
  sizeBytes: number | null;
  releasedAt: string | null;
  /** SHA-256 файла из манифеста: шторка показывает первые 8 символов как подтверждение сверки. */
  sha256: string | null;
  /** Короткие тезисы из `/version` — резерв, если чейнджлог не успел загрузиться. */
  notes: string[];
}

interface UpdateContextValue {
  /** Ближайшее обновление или `null`, если всё актуально. */
  pending: PendingUpdate | null;
  /** Пользователь закрыл капсулу: шторка из «Інфо» остаётся доступной. */
  dismissed: boolean;
  phase: UpdatePhase;
  /** 0…1 — прогресс скачивания APK. */
  progress: number;
  error: string | null;
  /** APK уже скачан и сверен по SHA-256: кнопка меняется на «Встановити». */
  apkReady: boolean;
  /** Шторка «Що нового» открыта. */
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  /** Скрыть капсулу до следующего запуска. */
  dismiss: () => void;
  /** Скачать APK (у OTA скачивание идёт в фоне само). */
  startDownload: () => void;
  /** Применить: OTA — перезапуск процесса, APK — системный установщик. */
  apply: () => void;
  /** Метаданные последней сборки с сервера (`/api/v1/version`): apkUrl, releasedAt, размер. */
  versionMeta: AppVersionInfo | null;
  /** Ступень карточки обновлений: idle → downloading → verifying → ready (или error). */
  stage: UpdateStage;
  /** Прогресс активной ступени в процентах 0…100; `null` — скачивание не идёт. */
  stageProgress: number | null;
  /** Какой контур обновления сейчас в работе: тихий бандл или полный APK. */
  stageKind: UpdateKind | null;
  /** Текст ошибки ступени; сбрасывается повторным запуском и `clearError()`. */
  errorMessage: string | null;
  /** Быстрый OTA: скачать JS-бандл, сверить и применить перезапуском процесса. */
  startOtaUpdate: () => void;
  /** Полный APK: скачать с прогрессом и сверить SHA-256; установка — кнопкой на ступени «ready». */
  startApkUpdate: () => void;
  /** Сбросить ошибку и вернуть карточку в исходное состояние. */
  clearError: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

/** Прямая ссылка на APK в GitHub Releases: первичный источник, `versionMeta.apkUrl` — резерв. */
function githubApkUrl(version: string): string {
  return `https://github.com/OlegVapnik/svitlo/releases/download/v${version}/svitlo-${version}.apk`;
}


/** Ключ, по которому запоминаем отклонение: новая версия снова покажет капсулу. */
function pendingKey(update: PendingUpdate): string {
  return `${update.kind}:${update.version}`;
}

/**
 * Обновления приложения в одном месте: тихий OTA (JS-бандл) и полный APK.
 *
 * Провайдер стоит под `QueryClientProvider`: `/api/v1/version` читается через общий react-query
 * (`staleTime` 6 часов), а сам факт наличия APK — не повод блокировать первый экран. Порядок
 * приоритетов: если сервер опубликовал APK новее установленного, капсула говорит про него —
 * нативные изменения бандлом не приедут.
 *
 * OTA скачивается молча в фоне: капсула появляется только когда файл уже на диске и проверен.
 * APK — наоборот, по кнопке: 34 МБ мобильного трафика без согласия человека недопустимы.
 */
export function UpdateProvider({ children }: { children: ReactNode }) {
  const versionQuery = useAppVersion();
  const apkInfo: AppVersionInfo | null = versionQuery.data?.data ?? null;
  // OTA-бандл — Android Hermes-файл, а APK ставит только Android PackageInstaller.
  // На iOS обновления приходят из App Store; скачивать android.bundle туда нельзя —
  // нативный загрузчик его не поймёт, а приложение останется без рабочего JS.
  const isAndroid = Platform.OS === 'android';
  const apkUpdate = Boolean(isAndroid && apkInfo && isNewerVersion(apkInfo.version, APP_VERSION));

  const [otaVersion, setOtaVersion] = useState<string | null>(null);
  const [otaSize, setOtaSize] = useState<number | null>(null);
  const [otaSha, setOtaSha] = useState<string | null>(null);
  // Стейт-машина карточки обновлений. Легаси-поля (phase/progress/error) выводятся из неё,
  // чтобы ChangelogSheet и старые потребители работали без изменений.
  const [stage, setStage] = useState<UpdateStage>('idle');
  const [stageKind, setStageKind] = useState<UpdateKind | null>(null);
  const [stageProgress, setStageProgress] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [apkReady, setApkReady] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isAndroid) return;
    // Успешный монтаж = прошлый бандл рабочий: снимаем маркер отката и фиксируем SHA.
    // Ждём подтверждение, иначе `pendingOtaVersion()` успевает прочитать старый meta.json
    // и на один кадр показывает капсулу про уже применённое обновление.
    void (async () => {
      await confirmOtaBoot();
      const version = await pendingOtaVersion();
      // Бандл с CDN не должен откатывать интерфейс назад: если он старее установленного
      // APK, предлагать его как обновление нельзя.
      if (version && compareVersions(version, APP_VERSION) >= 0) setOtaVersion(version);
    })();
  }, [isAndroid]);

  useEffect(() => {
    if (!isAndroid) return;
    let active = true;
    const check = async () => {
      const info = await fetchOtaBundleInfo();
      if (!active || !info) return;
      // Тот же рубеж для свежего манифеста: OTA-бандл 2.26.0 на устройстве с APK 2.27.0 —
      // это откат JS, а не обновление. Равные версии оставляем: JS мог уехать вперёд
      // с тем же versionName APK.
      if (compareVersions(info.version, APP_VERSION) < 0) return;
      const downloaded = await downloadOtaBundle(info);
      if (!active || !downloaded) return;
      setOtaVersion(downloaded);
      setOtaSize(info.sizeBytes ?? null);
      setOtaSha(info.sha256 ?? null);
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isAndroid]);

  useEffect(() => {
    if (!isAndroid || !apkInfo || !apkUpdate) {
      setApkReady(false);
      return;
    }
    let active = true;
    void hasDownloadedApk(apkInfo).then((ready) => {
      if (active) setApkReady(ready);
    });
    return () => {
      active = false;
    };
  }, [apkInfo, apkUpdate]);

  const pending = useMemo<PendingUpdate | null>(() => {
    if (apkInfo && apkUpdate) {
      return {
        kind: 'apk',
        version: apkInfo.version,
        sizeBytes: apkInfo.sizeBytes || null,
        releasedAt: apkInfo.releasedAt ?? null,
        sha256: apkInfo.sha256 ?? null,
        notes: apkInfo.notes ?? [],
      };
    }
    if (otaVersion) {
      return { kind: 'ota', version: otaVersion, sizeBytes: otaSize, releasedAt: null, sha256: otaSha, notes: [] };
    }
    return null;
  }, [apkInfo, apkUpdate, otaSha, otaSize, otaVersion]);

  /**
   * Перезапуск процесса через нативный `AppRestart`: гасит процесс и поднимает launcher-intent.
   * Возвращает `false`, если сборка старая и модуля нет — вызывающий код остаётся с честным
   * «застосується після наступного запуску» вместо ложного «готово».
   */
  const restartApp = useCallback((): boolean => {
    // Два пути к одному модулю: в bridgeless-режиме legacy-модуль может быть виден только
    // через TurboModuleRegistry (interop layer), а в старом — через NativeModules.
    type RestartModule = { restart?: () => void };
    const registry = TurboModuleRegistry as unknown as { get<T>(name: string): T | null };
    const restart =
      (NativeModules as { AppRestart?: RestartModule }).AppRestart?.restart ??
      registry.get<RestartModule>('AppRestart')?.restart;
    if (typeof restart !== 'function') return false;
    setApplying(true);
    setErrorMessage(null);
    restart();
    return true;
  }, []);

  /**
   * Полный APK: скачать (сначала GitHub Releases, при неудаче — apkUrl из `/api/v1/version`),
   * сверить SHA-256 на отдельной ступени и остановиться на «ready». Установка — отдельным
   * действием (`apply`), чтобы человек сам решал, когда открывать системный установщик.
   */
  const startApkUpdate = useCallback(() => {
    if (!isAndroid || !apkInfo || stage === 'downloading' || stage === 'verifying') return;
    setStageKind('apk');
    setStage('downloading');
    setStageProgress(0);
    setErrorMessage(null);
    void (async () => {
      // После последнего байта начинается сверка SHA-256: 34 МБ хэшируются пару секунд,
      // и без отдельной фазы интерфейс выглядел бы зависшим на 99 %.
      const onProgress = (fraction: number) => {
        setStageProgress(Math.round(fraction * 100));
        setStage(fraction >= 1 ? 'verifying' : 'downloading');
      };
      // Файл в обоих источниках один и тот же — SHA-256 сверяется в обоих случаях.
      const githubUrl = githubApkUrl(apkInfo.version);
      let result =
        githubUrl !== apkInfo.apkUrl ? await downloadApk({ ...apkInfo, apkUrl: githubUrl }, onProgress) : null;
      if (!result) result = await downloadApk(apkInfo, onProgress);
      if (result) {
        setApkReady(true);
        setStageProgress(100);
        setStage('ready');
        return;
      }
      setStage('error');
      setErrorMessage('Не вдалося завантажити APK. Перевірте зв’язок і спробуйте ще раз.');
    })();
  }, [apkInfo, isAndroid, stage]);

  /** Прежнее имя для шторки «Що нового»: тот же полный APK с прогрессом. */
  const startDownload = startApkUpdate;

  /**
   * Быстрый OTA: скачать JS-бандл, дождаться сверки хэша внутри `downloadOtaBundle`
   * (ступень «verifying») и применить перезапуском процесса. Если бандл уже на диске —
   * ступени скачивания пропускаются, карточка сразу показывает «готово».
   */
  const startOtaUpdate = useCallback(() => {
    if (!isAndroid || stage === 'downloading' || stage === 'verifying') return;
    setStageKind('ota');
    setErrorMessage(null);
    if (pending?.kind === 'ota') {
      setStageProgress(100);
      setStage('ready');
      if (!restartApp()) {
        setErrorMessage('Оновлення застосується після наступного запуску застосунку.');
      }
      return;
    }
    setStage('downloading');
    setStageProgress(0);
    void (async () => {
      const info = await fetchOtaBundleInfo();
      if (!info || compareVersions(info.version, APP_VERSION) <= 0) {
        // Нового JS-бандла нет — это не сбой, а «уже актуально»: возвращаем карточку в idle.
        setStage('idle');
        setStageProgress(null);
        setErrorMessage('Швидке OTA недоступне: новіший JS-бандл сервер не публікував.');
        return;
      }
      const version = await downloadOtaBundle(info, (fraction) => {
        setStageProgress(Math.round(fraction * 100));
        setStage(fraction >= 1 ? 'verifying' : 'downloading');
      });
      if (!version) {
        setStage('error');
        setErrorMessage('Не вдалося завантажити OTA-бандл. Перевірте зв’язок і спробуйте ще раз.');
        return;
      }
      setOtaVersion(version);
      setOtaSize(info.sizeBytes ?? null);
      setOtaSha(info.sha256 ?? null);
      setStageProgress(100);
      setStage('ready');
      // Применение OTA — это перезапуск: нативный загрузчик подхватит бандл со старта.
      if (!restartApp()) {
        setErrorMessage('Оновлення застосується після наступного запуску застосунку.');
      }
    })();
  }, [isAndroid, pending, restartApp, stage]);

  const clearError = useCallback(() => {
    setErrorMessage(null);
    setStageProgress(null);
    setStage((current) => (current === 'error' ? 'idle' : current));
  }, []);

  const apply = useCallback(() => {
    if (!isAndroid || !pending) return;
    if (pending.kind === 'apk') {
      if (!apkInfo) return;
      if (!apkReady) {
        startDownload();
        return;
      }
      setStageKind('apk');
      setApplying(true);
      setErrorMessage(null);
      void installApk(apkPath(apkInfo.version)).then((result) => {
        if (result === 'opened') {
          setApplying(false);
          setStage('ready');
          return;
        }
        setApplying(false);
        setStage('error');
        setErrorMessage(
          result === 'unsupported'
            ? 'Ця збірка не вміє ставити APK сама. Завантажте новий APK із сайту й установіть його вручну.'
            : 'Система не відкрила інсталятор. Дозвольте встановлення з цього джерела в налаштуваннях.',
        );
      });
      return;
    }

    // OTA: путь к бандлу читается один раз при старте процесса, поэтому «застосувати» —
    // это перезапуск. Нативный модуль гасит процесс и поднимает launcher-intent.
    if (restartApp()) return;
    // Старая сборка без нативного модуля: обещать мгновенное применение нельзя, но и молчать
    // о том, что бандл уже на диске, — тоже.
    setErrorMessage('Оновлення застосується після наступного запуску застосунку.');
  }, [apkInfo, apkReady, isAndroid, pending, restartApp, startDownload]);

  // Легаси-проекция стейт-машины для существующих потребителей (ChangelogSheet и др.).
  const phase: UpdatePhase = applying ? 'applying' : stage;
  const legacyProgress = (stageProgress ?? 0) / 100;

  const value = useMemo<UpdateContextValue>(
    () => ({
      pending,
      dismissed: Boolean(pending && dismissedKey === pendingKey(pending)),
      phase,
      progress: legacyProgress,
      error: errorMessage,
      apkReady,
      sheetOpen,
      openSheet: () => setSheetOpen(true),
      closeSheet: () => setSheetOpen(false),
      dismiss: () => {
        if (pending) setDismissedKey(pendingKey(pending));
      },
      startDownload,
      apply,
      versionMeta: apkInfo,
      stage,
      stageProgress,
      stageKind,
      errorMessage,
      startOtaUpdate,
      startApkUpdate,
      clearError,
    }),
    [
      apkInfo,
      apkReady,
      apply,
      clearError,
      dismissedKey,
      errorMessage,
      legacyProgress,
      pending,
      phase,
      sheetOpen,
      stage,
      stageKind,
      stageProgress,
      startApkUpdate,
      startDownload,
      startOtaUpdate,
    ],
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdates(): UpdateContextValue {
  const context = useContext(UpdateContext);
  if (!context) throw new Error('useUpdates must be used inside UpdateProvider');
  return context;
}
