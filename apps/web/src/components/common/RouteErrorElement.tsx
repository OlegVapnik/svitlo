import { useRouteError } from 'react-router-dom';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button.js';

/**
 * Экран ошибки маршрута.
 *
 * Зачем он вместо служебного «Hey developer»: тот текст ничего не объясняет человеку и
 * не даёт выбраться — приложение остаётся в белом экране до перезагрузки. Здесь две
 * кнопки, которые в самом деле возвращают приложение в рабочее состояние:
 *
 *   «Оновити сторінку» — обычная перезагрузка. Помогает, когда сбой вызван новой сборкой
 *   или временным сбоем сети;
 *   «Скинути кеш» — перезагрузка с очисткой localStorage. Нужна, когда в кеш попал битый
 *   ответ API (именно так проявился несовпавший контракт `/status`: старый ответ лежал
 *   в кеше и падал при каждом запуске, пока его не убирали).
 *
 * Текст ошибки показываем, но не как «стек для разработчика», а одной строкой: имя ошибки
 * помогает понять, что ремонтировать, а полный стек в мобильном WebView только пугает.
 */
export const RouteErrorElement = () => {
  const error = useRouteError();

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Невідома помилка';

  const hardReload = () => {
    window.location.reload();
  };

  /** Полная очистка: кеш ответов API, офлайн-снимок графиков, закладки и выбранная область. */
  const clearCacheAndReload = () => {
    try {
      // Чистим выборочно по префиксам нашего приложения, а не весь localStorage:
      // чужие ключи браузера трогать нельзя.
      const doomed: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && (key.startsWith('svitlo:') || key.startsWith('queue') || key.startsWith('region'))) {
          doomed.push(key);
        }
      }
      for (const key of doomed) localStorage.removeItem(key);
    } catch {
      // Приватный режим или запрет хранилища — просто перезагружаемся без очистки.
    }
    window.location.reload();
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-2xl border border-border bg-card px-5 py-6">
        <h1 className="text-lg font-bold text-foreground">Щось пішло не так</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Сторінка не змогла показати дані. Спробуйте оновити її — це не відміняє ваші закладки.
        </p>
        <p className="mt-3 break-words rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {message}
        </p>
      </div>

      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Button onClick={hardReload} className="gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden />
          Оновити сторінку
        </Button>
        <Button onClick={clearCacheAndReload} variant="outline" className="gap-2">
          <Trash2 className="h-4 w-4" aria-hidden />
          Скинути кеш
        </Button>
      </div>
    </div>
  );
};
