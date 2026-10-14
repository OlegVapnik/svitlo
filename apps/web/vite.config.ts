import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  define: {
    // Метка сборки видна в интерфейсе (нижняя часть меню). Нужна, чтобы отличить на телефоне
    // старую установленную версию APK от свежей: при отладке «ничего не работает» первым
    // делом проверяется именно она — иначе неизвестно, какой бандл реально запущен.
    __BUILD_ID__: JSON.stringify(process.env.SVITLO_BUILD_ID ?? 'dev'),
  },
  plugins: [
    react(),
    // Tailwind v4 подключается плагином Vite (в v3 это был postcss.config.js + tailwind.config.ts).
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Не ждём закрытия всех вкладок: старый precache-кэш вычищаем, иначе браузер месяц
      // показывает прежний бандл и «залипает» на старой вёрстке.
      cleanupOutdatedCaches: true,
      // Разово и сразу снимаем PWA, который так долго отдавал старый бандл: sw.js сам удалит
      // все кэши workbox и разрегистрируется во всех вкладках. Вернём офлайн позже, когда
      // убедимся, что «залипание» больше не повторяется.
      selfDestroying: true,
      manifest: {
        name: 'Svitlo — Чернігів',
        short_name: 'Svitlo',
        lang: 'uk',
        start_url: '/',
        display: 'standalone',
        theme_color: '#f3efe6',
        background_color: '#f3efe6',
        icons: [
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // Новый SW вступает в силу сразу и забирает открытые вкладки — без кнопки «обновить».
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/api\//],
        // API намеренно НЕ кэшируется Service Worker'ом: кэш api-responses отдавал устаревший
        // (в том числе пустой) ответ графика, и главная показывала «Даних графіка немає», хотя
        // бэкенд отдавал интервалы. График очереди должен приходить только из сети.
        runtimeCaching: []
      }
    })
  ],
  resolve: {
    alias: {
      // import.meta.dirname вместо __dirname: Vite 8 ругается на __dirname (native config loader).
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
});