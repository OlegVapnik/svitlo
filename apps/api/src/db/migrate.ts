import { sql } from 'drizzle-orm';
import { db } from './connection.js';
import { logger } from '../utils/logger.js';

async function main() {
  logger.info('Running migrations...');
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS __energy_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const migrationUrl = new URL('./migrations/', import.meta.url);
    const { readdir, readFile } = await import('node:fs/promises');
    const files = (await readdir(migrationUrl)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const [alreadyApplied] = await db.execute(sql`SELECT 1 FROM __energy_migrations WHERE name = ${file}`) as unknown as [{ '?column?': number }?];
      if (alreadyApplied) continue;
      const contents = await readFile(new URL(file, migrationUrl), 'utf8');
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(contents));
        await tx.execute(sql`INSERT INTO __energy_migrations (name) VALUES (${file})`);
      });
      logger.info({ migration: file }, 'Migration applied');
    }
    logger.info('Migrations applied successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  }
}

main();
