/**
 * Спільні типи для модулів парсерів та колектора новин.
 */
import type { NewsKind } from '@svitlo/shared';

export interface RawParsedNewsItem {
  url: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  publishedAt: string | null; // ISO 8601 UTC
  /** URL зображень поста (Telegram-графіки картинками); відсутнє/порожнє — текстовий пост. */
  imageUrls?: string[];
  raw?: unknown;
}

export interface ClassifiedNewsItem extends RawParsedNewsItem {
  regionCpu: string | null;
  kind: NewsKind;
  isUkraineWide: boolean;
  tags: string[];
  contentHash: string;
}
