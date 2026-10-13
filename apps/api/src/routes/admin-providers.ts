import type { FastifyInstance } from 'fastify';
import { desc, inArray, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { parseRuns, sources } from '../db/schema.js';
import { getRegisteredProviders } from '../providers/registry.js';
import { syncProviderSchedules } from '../services/provider-sync.service.js';

/**
 * Адмінські маршрути провайдерів графіків: моніторинг і ручний запуск синхронізації.
 * Токен — як у решті адмінських маршрутів (`plugins/auth.ts`, Bearer ADMIN_TOKEN).
 */
export default async function adminProviderRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/admin/providers', { preHandler: [(fastify as any).authenticate] }, async () => {
    const { providers, skipped } = await getRegisteredProviders();

    // Провайдерські джерела тримаємо з is_active = false (їх веде PROVIDER_SYNC, а не old-pipeline).
    const providerSources = await db
      .select({ id: sources.id, url: sources.url, lastError: sources.lastError, lastSuccessAt: sources.lastSuccessAt })
      .from(sources)
      .where(sql`type = 'schedule-provider'`);
    const sourceByUrl = new Map(providerSources.map((row) => [row.url, row]));
    const sourceIds = providerSources.map((row) => row.id);
    const runs = sourceIds.length
      ? await db
          .select({ sourceId: parseRuns.sourceId, status: parseRuns.status, errorMessage: parseRuns.errorMessage, startedAt: parseRuns.startedAt })
          .from(parseRuns)
          .where(inArray(parseRuns.sourceId, sourceIds))
          .orderBy(desc(parseRuns.startedAt))
      : [];
    const lastRunBySource = new Map<string, { status: string; errorMessage: string | null; startedAt: Date }>();
    for (const run of runs) {
      if (!lastRunBySource.has(run.sourceId)) lastRunBySource.set(run.sourceId, run);
    }

    return {
      data: providers.map((provider) => {
        const source = sourceByUrl.get(provider.sourceUrl);
        const lastRun = source ? lastRunBySource.get(source.id) : undefined;
        return {
          id: provider.id,
          displayName: provider.displayName,
          sourceUrl: provider.sourceUrl,
          regions: provider.regions,
          lastRunAt: lastRun?.startedAt.toISOString() ?? null,
          lastStatus: lastRun?.status ?? null,
          lastError: lastRun?.errorMessage ?? source?.lastError ?? null,
        };
      }),
      meta: { skipped },
    };
  });

  // Ручний запуск синхронізації (той самий код, що й у cron).
  fastify.post('/api/v1/admin/providers/sync', { preHandler: [(fastify as any).authenticate] }, async () => {
    const { providers, skipped } = await getRegisteredProviders();
    const reports = await syncProviderSchedules(providers);
    return { data: { providers: reports }, meta: { skipped } };
  });
}
