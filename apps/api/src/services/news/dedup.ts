/**
 * Дедуплікація новин: генерація детермінованого sha256 хешу.
 */
import { createHash } from 'node:crypto';

/**
 * Рахує SHA-256 хеш від нормалізованих (title + url + дата).
 */
export function computeNewsContentHash(
  title: string,
  url: string,
  publishedAt: string | null = null,
): string {
  const normTitle = title.trim().toLowerCase().replace(/\s+/g, ' ');
  const normUrl = url.trim().toLowerCase();
  const normDate = (publishedAt ?? '').trim();

  return createHash('sha256')
    .update(`${normTitle}|${normUrl}|${normDate}`, 'utf8')
    .digest('hex');
}
