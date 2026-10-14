import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queueCodeSchema, scheduleImportRequestSchema } from '@svitlo/shared';
import { importOperatorSchedule } from '../services/schedule-import.service.js';
import { fetchOperatorSchedule, OperatorScheduleFetchError } from '../services/operator-schedule.service.js';
import { importTelegramSchedule } from '../services/telegram-schedule.service.js';
import { importMirrorScheduleFromSource } from '../services/mirror-schedule.service.js';
import { AppError } from '../utils/errors.js';
import type { OperatorStateCode } from '@svitlo/shared';
import { db } from '../db/connection.js';
import { sources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { runParse } from '../services/parse.service.js';

/** Тіло автозавантаження графіка: код черги («3» або «2/2») + дата YYYY-MM-DD. */
const fetchScheduleRequestSchema = z.object({
  queue: queueCodeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date должно быть YYYY-MM-DD'),
});

export default async function adminRoutes(fastify: FastifyInstance) {
  // Негайний запуск парсингу реальних джерел (web-API оператора тощо) + синхронізація графіків
  // провайдерів (уся Україна). Корисно, щоб побачити свіжі відключення, не чекаючи планувальника.
  fastify.post(
    '/api/v1/admin/parse',
    { preHandler: [(fastify as any).authenticate] },
    async () => {
      const activeSources = await db.select().from(sources).where(eq(sources.isActive, true));
      const results: Array<{ sourceId: string; name: string; recordsFound?: number; error?: string }> = [];
      for (const source of activeSources) {
        try {
          const data = await runParse(source.id);
          // runParse возвращает null, когда сбор отключений выключен (CHERNIHIV_WEB_ENABLED=false):
          // прогон не запускался, записей нет — это не ошибка, и «0» здесь вводил бы в заблуждение.
          if (data === null) {
            results.push({ sourceId: source.id, name: source.name, recordsFound: 0 });
            continue;
          }
          results.push({ sourceId: source.id, name: source.name, recordsFound: data.outages.length });
        } catch (error) {
          results.push({ sourceId: source.id, name: source.name, error: error instanceof Error ? error.message : String(error) });
        }
      }

      // ГРАФІКИ ПРОВАЙДЕРІВ (мультирегіональність): той самий тригер оновлює і відключення,
      // і розклад ГПВ провайдерів з усіх областей України. Захищено try/catch: навіть якщо
      // жоден провайдер не зареєстрований — запит не падає, відключення вже збережені вище.
      const providerReports: Array<{ providerId: string; ok?: boolean; slots?: number; error?: string | null }> = [];
      const providerNotes: string[] = [];
      try {
        const { getRegisteredProviders } = await import('../providers/registry.js');
        const { syncProviderSchedules } = await import('../services/provider-sync.service.js');
        const { providers, skipped } = await getRegisteredProviders();
        if (providers.length > 0) {
          const reports = await syncProviderSchedules(providers);
          providerReports.push(...reports.map((r) => ({ providerId: r.providerId, ok: r.ok, slots: r.slots, error: r.error })));
          if (skipped.length > 0) providerNotes.push(...skipped);
        } else {
          providerNotes.push(...skipped);
        }
      } catch (error) {
        providerNotes.push(error instanceof Error ? error.message : String(error));
      }

      return { data: { results, providers: providerReports, notes: providerNotes } };
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
          aData: (parsed.payload.aData ?? []).map((slot) => ({
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

  // Автозавантаження погодинного графіка ГПВ прямо з оператора (POST /api/info_schedule).
  // Капчі на цьому ендпоінті немає, персональних даних він не містить — надсилаємо лише чергу й дату.
  // Це заміняє копіпасту JSON зі сторінки ручного імпорту; результат пише в schedule_slots (source='operator').
  fastify.post(
    '/api/v1/admin/schedules/fetch',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any) => {
      const parsed = fetchScheduleRequestSchema.parse(req.body);
      let payload;
      try {
        payload = await fetchOperatorSchedule(parsed.queue, parsed.date);
      } catch (error) {
        if (error instanceof OperatorScheduleFetchError) {
          throw new AppError(502, 'OPERATOR_UNAVAILABLE', error.message);
        }
        throw error;
      }
      const result = await importOperatorSchedule(parsed.queue, parsed.date, payload, 'operator');
      // intervals — скільки інтервалів віддав оператор (0 + mergedIntervals 0 = «графіка немає»).
      return { data: { ...result, intervals: payload.aData.length } };
    },
  );

  // Імпорт погодинного ГПВ з ПУБЛІЧНОГО Telegram-каналу оператора (t.me/s/chernigivoblenergo).
  // Капчі й персональних даних там немає, мережа не потрібна: читаємо вже збережені пости
  // (`TelegramChannelAdapter`) і пишемо `schedule_slots` з `source = 'telegram'`.
  // Це єдиний канал, який реально дає черги+час після того, як з'ясувалося, що `info_schedule` —
  // заглушка, а `info_schedule_part` закритий Turnstile (HANDOFF §18.9).
  fastify.post(
    '/api/v1/admin/schedules/import-telegram',
    { preHandler: [(fastify as any).authenticate] },
    async () => ({ data: await importTelegramSchedule() }),
  );

  // Імпорт ПОВНОГО добового ГПВ із публічного «дзеркала» (MIRROR_SCHEDULE_URL, типово
  // https://dtek-api.svitlo-proxy.workers.dev/). Це те саме джерело, що читає Java-ядро `core/`
  // (`BlackoutScheduleProvider`): один JSON на всі області, усередині `schedule[черга][дата][HH:MM]`,
  // де `2` = відключення. Капчі й персональних даних немає. Пише `source = 'mirror'`.
  // `?force=true` — ігнорувати TTL-кеш payload (10 хв) і звернутись до дзеркала зараз.
  fastify.post<{ Querystring: { force?: string } }>(
    '/api/v1/admin/schedules/import-mirror',
    { preHandler: [(fastify as any).authenticate] },
    async (req) => ({
      data: await importMirrorScheduleFromSource({ force: String(req.query.force ?? '') === 'true' }),
    }),
  );
}
