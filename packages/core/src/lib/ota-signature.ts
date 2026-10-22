import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

/**
 * Перевірка підпису OTA-маніфесту (`/ota/version.json`).
 *
 * Навіщо: SHA-256 у тому ж маніфесті доводить лише цілісність файлу, але не авторство.
 * Якщо CDN або GitHub-репозиторій скомпрометовано, підмінений маніфест зі своїм хешем
 * пройшов би перевірку. Ed25519-підпис приватним ключем поза репозиторієм прив'язує
 * маніфест до ключа, вшитого в APK, тому чужий бандл завантажити неможливо.
 *
 * Підписується канонічний JSON усього маніфесту без поля `signature`. `keyId` входить
 * у підпис: так не можна підмінити ключ, не зламавши підпис.
 */

/** Єдиний алгоритм, який зараз приймає застосунок. */
export const OTA_SIGNATURE_ALGORITHM = 'Ed25519';

/** Мапа `keyId -> публічний ключ` у base64 (32 сирі байти). */
export type OtaPublicKeys = Record<string, string>;

export type OtaSignatureResult =
  | { ok: true; keyId: string }
  | { ok: false; reason: string };

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// noble у Hermes не має вбудованого SHA-512: підключаємо синхронну реалізацію один раз.
ed.etc.sha512Sync = (...messages) => sha512(ed.etc.concatBytes(...messages));

/**
 * Канонічний JSON: ключі об'єктів відсортовані рекурсивно, без пробілів.
 *
 * Однакова реалізація в застосунку й у `tools/ota-signing.mjs` — інакше підпис не зійдеться.
 * Масиви лишаються у вихідному порядку: для `assets` порядок не смисловий, але міняти його
 * під час підпису небезпечно.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const fields = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`);
  return `{${fields.join(',')}}`;
}

/** Декодування base64 без Buffer/atob: Hermes не гарантує жодного з них. */
export function decodeBase64(base64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(base64) || base64.length % 4 !== 0) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/=+$/u, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let bitCount = 0;
  let index = 0;
  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value < 0) return null;
    bits = (bits << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[index++] = (bits >> bitCount) & 0xff;
    }
  }
  return index === bytes.length ? bytes : bytes.subarray(0, index);
}

/**
 * Перевіряє підпис маніфесту.
 *
 * Повертає причину відмови, а не кидає виняток: у циклі джерел OTA одну невалідну відповідь
 * треба просто пропустити й спробувати наступне джерело.
 */
export function verifyOtaManifestSignature(
  manifest: unknown,
  publicKeys: OtaPublicKeys,
): OtaSignatureResult {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, reason: 'маніфест не є об’єктом' };
  }
  const record = manifest as Record<string, unknown>;
  const keyId = record.keyId;
  if (typeof keyId !== 'string' || !keyId) {
    return { ok: false, reason: 'немає keyId' };
  }
  const signatureBase64 = record.signature;
  if (typeof signatureBase64 !== 'string' || !signatureBase64) {
    return { ok: false, reason: 'немає підпису' };
  }
  const publicKeyBase64 = publicKeys[keyId];
  if (!publicKeyBase64) {
    return { ok: false, reason: `невідомий ключ ${keyId}` };
  }
  const signature = decodeBase64(signatureBase64);
  if (!signature || signature.length !== 64) {
    return { ok: false, reason: 'підпис некоректної довжини' };
  }
  const publicKey = decodeBase64(publicKeyBase64);
  if (!publicKey || publicKey.length !== 32) {
    return { ok: false, reason: 'публічний ключ некоректної довжини' };
  }
  const { signature: _signature, ...payload } = record;
  try {
    const message = new TextEncoder().encode(canonicalizeJson(payload as JsonValue));
    if (!ed.verify(signature, message, publicKey, { zip215: false })) {
      return { ok: false, reason: 'підпис не збігається' };
    }
  } catch {
    return { ok: false, reason: 'помилка перевірки підпису' };
  }
  return { ok: true, keyId };
}
