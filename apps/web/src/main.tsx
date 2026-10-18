import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { hydrateOfflineStartup } from './api/offline-sync.js';
import { installNativeGuards, markNativeShell } from './lib/native-guards.js';
import './styles/globals.css';

/**
 * Удаляем кэш API от прошлых версий Service Worker'а. Он накапливался с runtimeCaching
 * `api-responses` и отдавал устаревший (в том числе пустой) ответ графика очереди — главная
 * показывала «Даних графіка немає», хотя бэкенд отдавал интервалы. Кэширования API больше нет,
 * поэтому старый кэш только мешает и должен умереть. Повторяем при каждом старте: старые SW
 * могли накопилить и другие кэши, а `cleanupOutdatedCaches` чистит лишь precache Workbox.
 */
if ('caches' in window) {
  for (const name of ['api-responses']) {
    void caches.delete(name).catch(() => undefined);
  }
}

/**
 * Гидратация офлайн-пакета ДО первого рендера.
 *
 * Почему не в useEffect: хуки страниц запускают запросы сразу при монтировании, и без сети
 * первый кадр рисовался бы пустым («Немає даних»), а сохранённый график приезжал бы вторым.
 * С гидратацией здесь приложение в офлайне показывает последний известный график с первого
 * кадра — ровно ради этого эндпоинт /sync и делался.
 */
hydrateOfflineStartup();

/**
 * Нативні жести — до першого рендера, щоб довге натискання на першому екрані вже не
 * відкривало браузерне меню. У браузері функція нічого не робить.
 */
installNativeGuards();
markNativeShell();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
