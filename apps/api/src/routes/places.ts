import type { FastifyInstance } from 'fastify';
import { accountNumberSchema, subscriberPlaceInputSchema } from '@svitlo/shared';
import { findPlaceByAccount, upsertPlace } from '../services/places.service.js';
import { AppError } from '../utils/errors.js';

/**
 * Перевірка за особовим рахунком: користувач вводить номер і бачить, яку вулицю та чергу
 * застосунок вважає його (раніше такої перевірки не було взагалі — була лише копіпаста JSON).
 *
 * Джерело довідника — дані оператора. Адресний `POST /api/list_acc` рахунку не повертає, а account-шукач
 * на /blackouts (піддомен interruptions.energy.cn.ua) номер черги віддає через Cloudflare Turnstile, а
 * `/api/code_review` повертає ПД (адреса, ЕІС, meter_id). Обхід капчі тепер ДОЗВОЛЕНО (дозвіл оператора,
 * 2026-10-10, див. AGENTS.md), проте ПД — це персональні дані, тому довідник і далі наповнюється
 * адмін-маршрутом, а не масовим збором (див. secrets-pii-hygiene).
 * Відповідь містить лише вулицю і чергу (без ПІБ) і не кешується: номер — персональні дані.
 */
export default async function placeRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { account: string } }>('/api/v1/places/:account', async (request, reply) => {
    const account = String(request.params.account ?? '').trim();
    reply.header('Cache-Control', 'no-store');
    if (!accountNumberSchema.safeParse(account).success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Особовий рахунок — 9–12 цифр');
    }
    const place = await findPlaceByAccount(account);
    if (!place) throw new AppError(404, 'PLACE_NOT_FOUND', 'Цього особового рахунку немає в довіднику');
    return { data: place };
  });

  // Завод/оновлення запису довідника (адмін): дані беремо з кабінету оператора вручну.
  fastify.put('/api/v1/admin/places', { preHandler: [(fastify as any).authenticate] }, async (request) => {
    const parsed = subscriberPlaceInputSchema.parse(request.body);
    return { data: await upsertPlace(parsed.account, parsed.street, parsed.queue) };
  });
}