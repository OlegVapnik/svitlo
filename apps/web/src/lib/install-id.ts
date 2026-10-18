/**
 * Установочный идентификатор приложения для антинакрутки народных голосов.
 *
 * ЗАЧЕМ. Воркер считает `voter_hash` из IP + User-Agent + этого идентификатора. Без стабильного
 * значения один и тот же человек с мобильного интернета (IP меняется) мог бы голосовать
 * несколько раз. Сам идентификатор случаен и ни с чем не связан: ни имени, ни телефона, ни
 * адреса — только «это та же установка приложения».
 *
 * ГДЕ ХРАНИМ. `localStorage`, а не cookie: cookie уходит на сервер с каждым запросом, а это
 * значение нужно только при явном голосе «це моя черга».
 */
const STORAGE_KEY = 'svitlo_install_id';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Safari < 15.4 и старые WebView: UUID собираем вручную из случайных байт.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Возвращает стабильный id установки, создавая его при первом обращении. */
export function getClientInstallId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = randomId();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // Приватный режим с запретом localStorage: голос всё равно уйдёт, просто без стабильного id.
    return '';
  }
}
