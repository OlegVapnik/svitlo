/**
 * Синхронізація графіків від провайдерів у БД: `schedule_slots` + довідник НП
 * (`settlements` / `settlement_queues`), плюс спостережуваність у `sources`/`parse_runs`.
 *
 * Навіщо окремий сервіс: провайдери (mirror, YASNO, DTEK, e-svitlo, Чернігівобленерго) ЧИСТІ —
 * вони лише віддають `ProviderSnapshot`. Уся робота з БД, відхиленням сміття й обліком прогонів
 * живе тут, в одному місці, і покрита тестами.
 *
 * Що гарантуємо:
 * 1. Нічого невигаданого: у БД їде лише те, що провайдер реально віддав.
 * 2. Дати з минулого НЕ пишемо (валідатор COLLECT P2, `allowPastDates=false`) — саме через це
 *    в БД раніше лежали липневі/квітневі дати й видавались за актуальні.
 * 3. Область поза каталогом `regions` → рядок відкидається (`unknownRegion`), а не створює сміття.
 * 4. Конфлікт по (region, queue, date, time_from) перезаписується; кількість перезаписів видно у звіті.
 */
import { and, eq, sql } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/connection.js';
import { parseRuns, regions, scheduleSlots, sources } from '../db/schema.js';
import { normalizeQueueCode, SLOT_STATE } from '../providers/intervals.js';
import type { ProviderSlot, RegionScheduleProvider } from '../providers/types.js';
import type { ProviderSyncReport } from '@svitlo/shared';
import { logger } from '../utils/logger.js';
import { validateScheduleSlots } from './data-quality.js';
import { kyivDate, normalizeSettlementKind, upsertSettlement, upsertSettlementQueue } from './settlements.service.js';

/** Тип звіту — у @svitlo/shared, щоб адмінка й веб бачили той самий контракт. */
export type SyncReport = ProviderSyncReport;

const WRITE_CHUNK = 500;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

type NormalizedSlot = ProviderSlot & { stateName: string; stateColor: string };

/**
 * Рядок джерела для моніторингу. `is_active = false` навмисно: цикл `runParseCycle` опитує лише
 * активні джерела старим пайплайном, а провайдерів веде `PROVIDER_SYNC_ENABLED`-розклад окремо.
 */
async function ensureSourceRow(provider: RegionScheduleProvider): Promise<string> {
  const [existing] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.url, provider.sourceUrl), eq(sources.name, provider.displayName)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(sources)
    .values({ name: provider.displayName, url: provider.sourceUrl, type: 'schedule-provider', isActive: false })
    .returning({ id: sources.id });
  return created!.id;
}

/** Мінімальна «суха» валідація на межі: черга у форматі застосунку + відомий код стану. */
function toNormalizedSlot(slot: ProviderSlot): NormalizedSlot | null {
  const queue = normalizeQueueCode(slot.queue);
  const state = SLOT_STATE[slot.stateCode];
  if (!queue || !state) return null;
  return { ...slot, queue, stateName: state.name, stateColor: state.color };
}

type SyncContext = { now: Date; today: string; knownRegions: Set<string>; fetchImpl?: typeof fetch };

async function syncOne(provider: RegionScheduleProvider, ctx: SyncContext): Promise<SyncReport> {
  const report: SyncReport = {
    providerId: provider.id, ok: false, slots: 0, inserted: 0, rewritten: 0, rejected: 0,
    staleDatesSkipped: 0, unknownRegion: 0, settlements: 0, settlementQueues: 0, error: null,
  };
  const sourceId = await ensureSourceRow(provider);
  const [run] = await db.insert(parseRuns).values({ sourceId, status: 'running', startedAt: ctx.now }).returning({ id: parseRuns.id });
  const runId = run?.id;
  try {
    const snapshot = await provider.fetchSchedules({
      fetchImpl: ctx.fetchImpl,
      signal: AbortSignal.timeout(env.PROVIDER_SYNC_TIMEOUT_MS),
    });

    // 1) Тільки області з каталогу + нормалізація черг і кодів стану.
    const normalized: NormalizedSlot[] = [];
    for (const slot of snapshot.slots ?? []) {
      if (!ctx.knownRegions.has(slot.region)) {
        report.unknownRegion += 1;
        continue;
      }
      const item = toNormalizedSlot(slot);
      if (!item) {
        report.rejected += 1;
        continue;
      }
      normalized.push(item);
    }

    // 2) Валідатор якості вирішує, що з цього взагалі можна писати (дати, інтервали, перетини).
    const accepted: NormalizedSlot[] = [];
    for (const region of [...new Set(normalized.map((slot) => slot.region))]) {
      const group = normalized.filter((slot) => slot.region === region);
      const validation = validateScheduleSlots(group, { regionCpu: region, sourceKey: provider.id, now: ctx.now });
      for (const rejection of validation.rejected) {
        if (rejection.code === 'PAST_DATE') report.staleDatesSkipped += 1;
        else report.rejected += 1;
      }
      accepted.push(...validation.accepted);
    }

    // 3) Запис слотів: конфлікт по (region, queue, date, time_from) перезаписуємо свідомо.
    const writeStartedAt = new Date();
    for (const chunk of chunks(accepted, WRITE_CHUNK)) {
      const written = await db
        .insert(scheduleSlots)
        .values(
          chunk.map((slot) => ({
            region: slot.region,
            queue: slot.queue,
            date: slot.date,
            timeFrom: slot.timeFrom,
            timeTo: slot.timeTo,
            stateCode: slot.stateCode,
            stateName: slot.stateName,
            stateColor: slot.stateColor,
            source: provider.id,
          })),
        )
        .onConflictDoUpdate({
          target: [scheduleSlots.region, scheduleSlots.queue, scheduleSlots.date, scheduleSlots.timeFrom],
          set: {
            timeTo: sql`excluded.time_to`,
            stateCode: sql`excluded.state_code`,
            stateName: sql`excluded.state_name`,
            stateColor: sql`excluded.state_color`,
            source: sql`excluded.source`,
          },
        })
        .returning({ createdAt: scheduleSlots.createdAt });
      report.slots += written.length;
      // Рядки, створені цим прогоном, — нові; решта — перезапис існуючих (created_at не змінюється).
      report.inserted += written.filter((row) => row.createdAt.getTime() >= writeStartedAt.getTime()).length;
    }
    report.rewritten = report.slots - report.inserted;

    // 4) Довідник НП і їхні черги — саме те, що дає людині «моє село → моя черга».
    for (const settlement of snapshot.settlements ?? []) {
      if (!ctx.knownRegions.has(settlement.region)) {
        report.unknownRegion += 1;
        continue;
      }
      const saved = await upsertSettlement({
        region: settlement.region,
        name: settlement.name,
        kind: normalizeSettlementKind(settlement.kind),
        source: provider.id,
        sourceRef: settlement.sourceRef ?? null,
      });
      if (!saved) {
        report.rejected += 1;
        continue;
      }
      report.settlements += 1;
      for (const rawQueue of settlement.queues ?? []) {
        const queue = normalizeQueueCode(rawQueue);
        if (!queue) {
          report.rejected += 1;
          continue;
        }
        await upsertSettlementQueue({
          region: settlement.region,
          settlementId: saved.id,
          queue,
          source: provider.id,
          sourceRef: settlement.sourceRef ?? null,
        });
        report.settlementQueues += 1;
      }
    }

    report.ok = true;
    const partial = report.rejected > 0 || report.staleDatesSkipped > 0 || report.unknownRegion > 0;
    if (runId) {
      await db
        .update(parseRuns)
        .set({
          status: partial ? 'partial' : 'success',
          recordsFound: report.slots + report.settlements,
          finishedAt: new Date(),
          errorMessage: partial
            ? `Відхилено: ${report.rejected}, застарілі дати: ${report.staleDatesSkipped}, невідомі області: ${report.unknownRegion}`
            : null,
        })
        .where(eq(parseRuns.id, runId));
    }
    await db.update(sources).set({ lastSuccessAt: new Date(), lastError: null }).where(eq(sources.id, sourceId));
    logger.info({ ...report }, 'Provider sync finished');
  } catch (error) {
    report.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    if (runId) {
      await db
        .update(parseRuns)
        .set({ status: 'error', errorMessage: report.error, finishedAt: new Date() })
        .where(eq(parseRuns.id, runId));
    }
    await db.update(sources).set({ lastError: report.error }).where(eq(sources.id, sourceId));
    logger.error({ err: error, providerId: provider.id }, 'Provider sync failed');
  }
  return report;
}
export async function syncProviderSchedules(
  providers: RegionScheduleProvider[],
  opts: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<SyncReport[]> {
  const now = opts.now ?? new Date();
  const today = kyivDate(now);
  const knownRegions = new Set((await db.select({ cpu: regions.cpu }).from(regions)).map((row) => row.cpu));
  const reports: SyncReport[] = [];
  for (const provider of providers) {
    reports.push(await syncOne(provider, { now, today, knownRegions, fetchImpl: opts.fetchImpl }));
  }
  return reports;
}
