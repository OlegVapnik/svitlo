import { NativeModules, Platform } from 'react-native';

/**
 * Мост к нативному live-статусу (`SvitloLiveModule`).
 *
 * Постоянная плашка шторки и QS-плитка обновляются самим Android на тиках виджетов, поэтому
 * JS только включает/выключает статус и просит систему добавить плитку. Когда нативный статус
 * доступен, notifee-плашка 'svitlo-live' не создаётся — иначе их было бы две.
 */
interface SvitloLiveBridge {
  setEnabled(enabled: boolean): void;
  isLiveEnabled(): Promise<boolean>;
  hasNotificationPermission(): Promise<boolean>;
  requestAddTile(): Promise<boolean>;
}

const bridge: SvitloLiveBridge | undefined = NativeModules.SvitloLive;

export function isNativeLiveAvailable(): boolean {
  return Platform.OS === 'android' && bridge != null;
}

/** Включает/выключает нативную плашку и плитку; JS-хуком тикерия не занимается. */
export function setNativeLiveEnabled(enabled: boolean): void {
  if (Platform.OS !== 'android' || !bridge) return;
  try {
    bridge.setEnabled(enabled);
  } catch {
    /* модуль недоступен в этой сборке — не падаем */
  }
}

export async function nativeLiveEnabled(): Promise<boolean> {
  if (Platform.OS !== 'android' || !bridge) return false;
  try {
    return Boolean(await bridge.isLiveEnabled());
  } catch {
    return false;
  }
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || !bridge) return false;
  try {
    return Boolean(await bridge.hasNotificationPermission());
  } catch {
    return false;
  }
}

/**
 * FROZEN: Просить систему додати QS-плитку (Android 13+: системний діалог з кнопкою «Додати»).
 * Тимчасово заморожено. Для розморозки викликайте unfreezeAndRequestAddTile або поверніть виклик моста.
 */
export async function requestAddTile(): Promise<boolean> {
  return false;
}

/** Функція для розморозки додавання QS-плитки при поверненні до розробки фічі. */
export async function unfreezeAndRequestAddTile(): Promise<boolean> {
  if (Platform.OS !== 'android' || !bridge) return false;
  try {
    return Boolean(await bridge.requestAddTile());
  } catch {
    return false;
  }
}
