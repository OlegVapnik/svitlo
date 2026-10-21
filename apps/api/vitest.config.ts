import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Файли інтеграційних тестів працюють з ОДНІЄЮ тестовою БД: кожен TRUNCATE-ить ті самі таблиці
    // і вставляє той самий source id. Паралельний запуск файлів давав FK-помилки та «duplicate key»
    // замість реальних результатів, тому файли йдуть послідовно (тести всередині файлу — і так по черзі).
    fileParallelism: false,
  },
});
