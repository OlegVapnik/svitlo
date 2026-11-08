/**
 * Публічні ключі для перевірки підпису OTA-маніфесту.
 *
 * Приватний ключ лежить ПОЗА репозиторієм (`~/.config/svitlo/ota-signing.key`), тому
 * навіть повний доступ до GitHub не дає змоги підписати чужий бандл. Додаючи новий ключ,
 * старий не видаляй одразу: користувачі зі старими APK мають пережити ротацію.
 *
 * `keyId` мусить збігатися з полем `keyId` у `/ota/version.json`.
 */
export const OTA_PUBLIC_KEYS: Record<string, string> = {
  'svitlo-ota-2026-1': 'AuwtZrLx1+Iao76JZI53UX/Wj9bItuB6Fo7XcOo7sRY=',
};
