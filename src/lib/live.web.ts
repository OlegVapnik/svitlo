/**
 * Web-заглушка «живого» статусу (Android Live Update / плитка).
 *
 * Нативний міст `SvitloLive` існує лише в APK: у браузері немає ні системної плитки, ні
 * постійного сповіщення. Тримаємо ті самі сигнатури, щоб екрани не розгалужувались на
 * платформу в кожному місці.
 */
export function isNativeLiveAvailable(): boolean {
  return false;
}

export function setNativeLiveEnabled(_enabled: boolean): void {
  /* немає що вмикати */
}

export async function nativeLiveEnabled(): Promise<boolean> {
  return false;
}

export async function hasNotificationPermission(): Promise<boolean> {
  return false;
}

export async function requestAddTile(): Promise<boolean> {
  return false;
}

export async function unfreezeAndRequestAddTile(): Promise<boolean> {
  return false;
}
