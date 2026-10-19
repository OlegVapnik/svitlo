import { QueryClient } from '@tanstack/react-query';

/**
 * Один клиент на приложение — как в вебе (apps/web/src/api/query-client.ts).
 * Дефолтные настройки оставляем пустыми: staleTime/refetch задаются в хуках запросов.
 */
export const queryClient = new QueryClient();
