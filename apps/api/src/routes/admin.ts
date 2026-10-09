import { FastifyInstance } from 'fastify';
import { scheduleImportRequestSchema } from '@energy-monitor/shared';
import { importOperatorSchedule } from '../services/schedule-import.service.js';
import type { OperatorStateCode } from '@energy-monitor/shared';
import { db } from '../db/connection.js';
import { sources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { runParse } from '../services/parse.service.js';

export default async function adminRoutes(fastify: FastifyInstance) {
  // Негайний запуск парсингу реальних джерел (web-API оператора тощо).
  // Корисно, щоб побачити свіжі відключення, не чекаючи планувальника.
  fastify.post(
    '/api/v1/admin/parse',
    { preHandler: [(fastify as any).authenticate] },
    async () => {
      const activeSources = await db.select().from(sources).where(eq(sources.isActive, true));
      const results: Array<{ sourceId: string; name: string; recordsFound?: number; error?: string }> = [];
      for (const source of activeSources) {
        try {
          const data = await runParse(source.id);
          results.push({ sourceId: source.id, name: source.name, recordsFound: data.outages.length });
        } catch (error) {
          results.push({ sourceId: source.id, name: source.name, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { data: results };
    },
  );

  fastify.post(
    '/api/v1/admin/schedules/import',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply) => {
      const parsed = scheduleImportRequestSchema.parse(req.body);
      const result = await importOperatorSchedule(
        parsed.queue,
        parsed.date,
        {
          status: parsed.payload.status,
          aData: parsed.payload.aData.map((slot) => ({
            time_from: slot.time_from,
            time_to: slot.time_to,
            queue: Number(slot.queue) as OperatorStateCode,
          })),
          aState: parsed.payload.aState,
        },
      );
      return result;
    },
  );
}
