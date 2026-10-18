import { FastifyInstance } from 'fastify';
import { createRequire } from 'node:module';
import path from 'node:path';
import { logger } from '../utils/logger.js';

interface ChangelogFile {
  generatedAt: string | null;
  version: string;
  totalReleases: number;
  totalFeatures: number;
  totalFixes: number;
  totalOptimizations: number;
  releases: Array<{
    version: string;
    date: string;
    tag: 'Release' | 'Update';
    features: string[];
    fixes: string[];
    optimizations: string[];
  }>;
}

/**
 * GET /api/v1/changelog — что изменилось в приложении.
 *
 * Зачем он по сети, а не внутри бандла: задеплоенный на сервере фикс обязан быть виден в уже
 * установленном приложении, без пересборки и переустановки APK. Раньше чейджлог жил внутри
 * бандла, и пользователь узнавал о серверных исправлениях только после следующей сборки.
 *
 * Файл — данные, а не лог��ка: он генерируется из истории git скриптом
 * tools/gen_changelog.mjs и коммитится, чтобы сборка в Docker не зависела от наличия .git.
 */
let cache: ChangelogFile | null = null;

function load(): ChangelogFile {
  if (cache) return cache;
  // JSON лежит рядом с исходниками сервиса: tsc не переносит .json в dist, поэтому читаем
  // через require по путю, заданному сборкой (см. copy в docker/Dockerfile.api).
  const require = createRequire(import.meta.url);
  // Файл лежит в dist/data рядом с корнем сборки, а этот модуль — в dist/routes, поэтому
  // относительный путь поднимается на уровень выше. Второй кандидат — запуск из исходников
  // (dev и `node --loader`), там путь другой.
  const candidates = [
    path.join(import.meta.dirname, '../data/changelog.json'),
    path.join(import.meta.dirname, '../src/data/changelog.json'),
  ];
  for (const candidate of candidates) {
    try {
      cache = require(candidate) as ChangelogFile;
      return cache;
    } catch {
      // Пробуем следующий путь: в dev-коде и в собранном образе файл лежит по-разному.
    }
  }
  // Совсем нет файла — честный пустой ответ, а не 500: раздел «Що нового» просто нечего показать.
  // Обязательно пишем в лог: тихо пустой чейджлог выглядит как «мы ничего не писали»,
  // хотя на деле сломался путь к данным.
  logger.warn({ candidates }, 'Changelog file not found; serving empty changelog');
  cache = {
    generatedAt: null,
    version: '0.0.0',
    totalReleases: 0,
    totalFeatures: 0,
    totalFixes: 0,
    totalOptimizations: 0,
    releases: [],
  };
  return cache;
}

export default async function changelogRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/changelog', async (_request, reply) => {
    const data = load();
    // Кэш на стороне клиента короткий: список обновляется при выкатке, а не по часам.
    // ETag — чтобы приложение не перекачивало неизменившийся список.
    reply.header('Cache-Control', 'public, max-age=300');
    reply.header('ETag', `W/"changelog-${data.version}-${data.totalFeatures + data.totalFixes + data.totalOptimizations}"`);
    return { data };
  });
}