import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Захищене порівняння рядків за сталим часом. `timingSafeEqual` потребує буферів однакової
 * довжини; щоб довжина секрету не протікала, порівнюємо SHA-256 хеші обох значень (завжди
 * 32 байти), а не самі рядки. Знімає timing-атаку по підбору символів і по довжині.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}