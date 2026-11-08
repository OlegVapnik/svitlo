import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Тесты мобильного клиента гоняют только чистые модули (`src/lib/*`), без React Native.
 *
 * `root` задан явно: без него Vite ищет `expo/tsconfig.base` от корня проекта, где пакета
 * `expo` нет, и падает ещё до первого теста. Нативные модули сюда не тянутся — для них нужен
 * jest-expo, а проверять форматтеры и уведомления достаточно Node.
 */
export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
