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
      // `cleanupOutdatedCaches` живёт в Workbox-опциях, а не в `VitePWAOptions` этой версии;
      // в режиме `selfDestroying` он и не нужен — service worker сам удаляет свои кэши.
      selfDestroying: true,
      manifest: {
        name: 'Svitlo — Чернігів',
        short_name: 'Svitlo',
        lang: 'uk',
        start_url: '/',
        display: 'standalone',
        // Цвета манифеста видит система ДО загрузки CSS: по ним окрашивается строка состояния
        // установленного приложения и фон окна при запуске. Здесь — фон тёмной темы из
        // globals.css (--md-surface-dim), иначе при старте мелькала бы старая болотная заливка.
        theme_color: '#09090b',
        background_color: '#09090b',
        icons: [
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            // Отдельная maskable-версия: у неё фон без скруглений, а молния уже внутри
            // безопасной зоны. Иначе Android обрезает углы и края иконки.
            src: '/icons/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable'
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