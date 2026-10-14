import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);