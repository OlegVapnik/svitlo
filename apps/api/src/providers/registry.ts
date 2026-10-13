/**
 * Реєстр провайдерів графіків (multi-region).
 *
 * Навіщо лениве завантаження: провайдери живуть у різних модулях і можуть бути ще не готові
 * (їх ведуть окремі гілки). Відсутній або зламаний модуль НЕ має роняти API — він просто
 * потрапляє у `skipped` і видно в логах та в `GET /api/v1/admin/providers`.
 *
 * Специфікатори — рядки, тому tsc не намагається розв'язати файли, яких ще немає.
 */
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import type { RegionScheduleProvider } from './types.js';

type Candidate = {
  id: string;
  /** Шлях відносно цього файлу, з розширенням .js (ESM). */
  module: string;
  /** Ім'я експортованого провайдера в модулі. */
  exportName: string;
  enabled: () => boolean;
};

const CANDIDATES: Candidate[] = [
  { id: 'mirror', module: './mirror.provider.js', exportName: 'mirrorProvider', enabled: () => env.MIRROR_SCHEDULE_ENABLED },
  { id: 'yasno', module: './yasno.provider.js', exportName: 'yasnoProvider', enabled: () => true },
  { id: 'dtek-kem', module: './dtek.provider.js', exportName: 'dtekProvider', enabled: () => true },
  { id: 'esvitlo-cn', module: './esvitlo.provider.js', exportName: 'esvitloProvider', enabled: () => true },
  { id: 'chernihivoblenergo', module: './chernihiv-oblenergo.provider.js', exportName: 'chernihivOblenergoProvider', enabled: () => true },
];

export async function getRegisteredProviders(): Promise<{ providers: RegionScheduleProvider[]; skipped: string[] }> {
  const providers: RegionScheduleProvider[] = [];
  const skipped: string[] = [];

  for (const candidate of CANDIDATES) {
    if (!candidate.enabled()) {
      skipped.push(`${candidate.id}: вимкнено в конфігурації`);
      continue;
    }
    try {
      const module = (await import(candidate.module)) as Record<string, unknown>;
      const provider = module[candidate.exportName] as RegionScheduleProvider | undefined;
      if (!provider || typeof provider.fetchSchedules !== 'function') {
        skipped.push(`${candidate.id}: модуль є, але провайдера «${candidate.exportName}» не експортовано`);
        continue;
      }
      providers.push(provider);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
      skipped.push(`${candidate.id}: модуль недоступний (${reason})`);
    }
  }

  if (skipped.length > 0) logger.warn({ skipped }, 'Not all schedule providers are registered');
  return { providers, skipped };
}
