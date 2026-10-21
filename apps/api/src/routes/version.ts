import { FastifyInstance } from 'fastify';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AppVersionInfo } from '@svitlo/shared';
import { logger } from '../utils/logger.js';

/**
 * GET /api/v1/version — последняя опубликованная сборка приложения.
 *
 * Файл `version.json` пишет `tools/build-android-apk.sh` после подписи APK: версия, SHA-256,
 * размер и ссылка обязаны описывать ровно тот файл, который лежит на сайте. Вручную этот файл
 * не редактируется — иначе клиент скачал бы APK, хеш которого не совпадает, и установка
 * остановилась бы на проверке.
 */
let cache: AppVersionInfo | null = null;

function load(): AppVersionInfo | null {
  if (cache) return cache;
  const require = createRequire(import.meta.url);
  const candidates = [
    path.join(import.meta.dirname, '../data/version.json'),
    path.join(import.meta.dirname, '../src/data/version.json'),
  ];
  for (const candidate of candidates) {
    try {
      cache = require(candidate) as AppVersionInfo;
      return cache;
    } catch {
      // В dev и в собранном образе файл может лежать по разным путям.
    }
  }
  logger.warn({ candidates }, 'Version file not found; /version will return 404');
  return null;
}

export default async function versionRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/version', async (_request, reply) => {
    const data = load();
    if (!data) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Версія збірки невідома' } });
    }
    // Короткий кеш: новая сборка должна доходить до приложения в течение 5 минут, но не
    // заставлять каждого пользователя читать файл при каждом запуске.
    reply.header('Cache-Control', 'public, max-age=300');
    reply.header('ETag', `W/"version-${data.version}-${data.sha256.slice(0, 12)}"`);
    return { data };
  });
}
