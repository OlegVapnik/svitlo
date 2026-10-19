import { QueryClient } from '@tanstack/react-query';

/**
 * Единый QueryClient приложения.
 *
 * Вынесен из App.tsx по одной причине: офлайн-пакет нужно гидратировать в main.tsx ДО первого
 * рендера (см. api/offline-sync.ts), а доступ к клиенту нужен там же, где и у компонентов.
 * Второй QueryClient означал бы два независимых кеша: данные из пакета лились бы в один, а
 * экраны читали бы другой — то есть офлайн не работал бы вообще.
 */
export const queryClient = new QueryClient();
