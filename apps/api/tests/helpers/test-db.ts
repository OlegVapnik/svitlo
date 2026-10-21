/**
 * Спільна підготовка тестової БД для інтеграційних тестів.
 *
 * Схема створюється тими самими SQL-міграціями, що й у прод (як apps/api/src/db/migrate.ts),
 * але кожен застосований файл записується в __energy_migrations, тому повторний виклик нічого
 * не перезапускає, а нові міграції (наприклад 0008) докочутьcя автоматично.
 *
 * Друга вимога: ніколи не бігти проти робочої БД — тому testDatabaseUrlOrSkip() відмовляється
 * працювати з базою, чиє ім'я не закінчується на _test.
 */
import { readdir, readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';

/**
 * Підключення імпортуємо ЛІНИВО: config.ts читає DATABASE_URL на імпорті, тому жоден модуль
 * цього файлу не має тягнути src/db/connection.js у топ-левелі — інакше тест упаде до beforeAll,
 * коли DATABASE_URL ще не підставлено.
 */
async function getDb() {
  const { db } = await import('../../src/db/connection.js');
  return db;
}

/** Повертає TEST_DATABASE_URL або '' (тоді describe.skipIf пропускає файл); робочу БД відкидає. */
export function testDatabaseUrlOrSkip(): string {
  const url = process.env.TEST_DATABASE_URL ?? '';
  if (!url) return '';
  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!/_test$/.test(databaseName)) {
    throw new Error(
      `refusing to run: TEST_DATABASE_URL must point at a throwaway *_test database (got "${databaseName}")`,
    );
  }
  return url;
}

/** Застосовує ще не застосовані SQL-міграції до поточної (тестової!) БД. */
export async function ensureTestSchema(): Promise<void> {
  const db = await getDb();
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS __energy_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const migrationUrl = new URL('../../src/db/migrations/', import.meta.url);
  const files = (await readdir(migrationUrl)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const [applied] = (await db.execute(
      sql`SELECT 1 FROM __energy_migrations WHERE name = ${file}`,
    )) as unknown as [unknown?];
    if (applied) continue;
    await db.execute(sql.raw(await readFile(new URL(file, migrationUrl), 'utf8')));
    await db.execute(sql`INSERT INTO __energy_migrations (name) VALUES (${file})`);
  }
}
