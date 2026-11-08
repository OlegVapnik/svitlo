/**
 * Web-заглушка контексту оновлень.
 *
 * Оновлення застосунку — це OTA-бандл (Hermes) і APK: у браузері/Mini App їх немає, свіжий
 * код приїжджає разом зі сторінкою. Провайдер лишається порожнім, щоб екрани «Інфо» й капсула
 * оновлень не падали, а `useUpdates()` віддавав чесний стан «усе актуально».
 */
import Constants from 'expo-constants';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { AppVersionInfo } from '@svitlo/shared';

import type { UpdateKind } from '@/lib/updates';

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

export type UpdatePhase = 'idle' | 'downloading' | 'verifying' | 'ready' | 'applying' | 'error';

export type UpdateStage = 'idle' | 'downloading' | 'verifying' | 'ready' | 'error';

export interface PendingUpdate {
  kind: UpdateKind;
  version: string;
  sizeBytes: number | null;
  releasedAt: string | null;
  sha256: string | null;
  notes: string[];
}

interface UpdateContextValue {
  pending: PendingUpdate | null;
  dismissed: boolean;
  phase: UpdatePhase;
  progress: number;
  error: string | null;
  apkReady: boolean;
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  dismiss: () => void;
  startDownload: () => void;
  apply: () => void;
  versionMeta: AppVersionInfo | null;
  stage: UpdateStage;
  stageProgress: number | null;
  stageKind: UpdateKind | null;
  errorMessage: string | null;
  startOtaUpdate: () => void;
  startApkUpdate: () => void;
  clearError: () => void;
}

const noop = () => {};

const idleValue: UpdateContextValue = {
  pending: null,
  dismissed: true,
  phase: 'idle',
  progress: 0,
  error: null,
  apkReady: false,
  sheetOpen: false,
  openSheet: noop,
  closeSheet: noop,
  dismiss: noop,
  startDownload: noop,
  apply: noop,
  versionMeta: null,
  stage: 'idle',
  stageProgress: null,
  stageKind: null,
  errorMessage: null,
  startOtaUpdate: noop,
  startApkUpdate: noop,
  clearError: noop,
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => idleValue, []);
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdates(): UpdateContextValue {
  const context = useContext(UpdateContext);
  if (!context) throw new Error('useUpdates must be used inside UpdateProvider');
  return context;
}
