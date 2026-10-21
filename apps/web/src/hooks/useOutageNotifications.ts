import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupOutageSummary } from '@svitlo/shared';
import { queryClient } from '../api/query-client.js';
import { useRegion } from '../context/RegionContext.js';
import { loadBookmarks } from './useBookmarks.js';
import { sanitizeQueueList } from '../lib/queue.js';
import { formatKyivTime } from '../lib/date.js';
import {
  collectUpcomingAlerts,
  filterUnnotified,
  getNotificationSupport,
  intervalsForQueues,
  markNotified,
  requestNotificationPermission,
  showLocalNotification,
  subscribeNotificationSupport,
  type NotificationSupport,
  type OutageAlert,
} from '../lib/outage-notifications.js';

/** Ключ списка «мої черги» — тот же, что читает useMyQueues. */
const MY_QUEUES_KEY = 'myQueues';
/** Как часто проверяем: минутный шаг даёт точность «за 30 минут» без лишних вычислений. */
const CHECK_INTERVAL_MS = 60_000;
/** Дней графика в кеше — тот же ключ, что наполняет офлайн-пакет. */
const SCHEDULE_DAYS = 2;

/** За чем следим: черга и область, к которой она относится. */
interface AlertTarget {
  region: string;
  queue: string;
  /** Человеческая подпись из закладки («Дім», «Батьки»). Пусто — подставим номер черги. */
  label: string;
}

/** «Мої черги» без области: они относятся к текущей области. Мусор старых версий отсекаем тем же
 *  правилом, что и хук useMyQueues. */
function readMyQueues(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    return sanitizeQueueList(JSON.parse(localStorage.getItem(MY_QUEUES_KEY) || '[]') as unknown[]);
  } catch {
    return [];
  }
}

/**
 * Что проверять на попередження.
 *
 * Два источника намеренно: «мої черги» знають только номер (область берём текущую), а закладки
 * несут собственную область — «дім у Чернігові, дача на Київщині» это две разные области, и по
 * одной текущей области вторая закладка не проверялась бы вовсе.
 */
function collectTargets(currentRegion: string): AlertTarget[] {
  const targets: AlertTarget[] = readMyQueues().map((queue) => ({ region: currentRegion, queue, label: '' }));
  for (const bookmark of loadBookmarks()) {
    targets.push({ region: bookmark.regionCpu, queue: bookmark.queue, label: bookmark.label });
  }
  return targets;
}

export interface OutageNotificationsApi {
  /** Состояние доступа к сповіщенням: по нему интерфейс решает, что показать в налаштуваннях. */
  support: NotificationSupport;
  /** Запросить доступ. Вызывать только из обработчика клика — иначе браузер откажет. */
  enable: () => void;
}

/**
 * Состояние доступа к сповіщенням для интерфейса.
 *
 * Отдельно от `useOutageNotifications`: настройки должны показывать и запрашивать доступ, но не
 * запускать второй движок проверки графика. Движок один — в AppShell.
 */
export function useNotificationSupport(): NotificationSupport {
  return useSyncExternalStore(subscribeNotificationSupport, getNotificationSupport, getNotificationSupport);
}

/** Запрашивает доступ к сповіщенням (для кнопки). Состояние обновится во всех подписчиках. */
export function enableNotifications(): void {
  void requestNotificationPermission();
}

/**
 * Локальные предупреждения об отключениях по сохранённым чергам.
 *
 * Источник данных — кеш TanStack Query, а не сеть: его наполняет офлайн-пакет, поэтому
 * предупреждение работает и без связи. Смотрим только на свои черги: предупреждать о чужих
 * группах бессмысленно, а «следить за всей областью» — это спам, который человек отключит
 * вместе с нужными предупреждениями.
 *
 * Пока приложение закрыто, таймер не тикает: без push-сервера уведомления в фоне физически
 * невозможны (см. lib/outage-notifications.ts). Обещать обратное в тексте — обман.
 */
export function useOutageNotifications(): OutageNotificationsApi {
  const { t } = useTranslation();
  const { currentRegion } = useRegion();
  const support = useNotificationSupport();

  const enable = useCallback(() => {
    enableNotifications();
  }, []);

  useEffect(() => {
    if (support !== 'granted') return;

    const check = () => {
      const found = new Map<string, { alert: OutageAlert; label: string }>();

      for (const target of collectTargets(currentRegion)) {
        const cached = queryClient.getQueryData<{ data: GroupOutageSummary[] }>([
          'upcomingGroupOutages',
          target.region,
          SCHEDULE_DAYS,
        ]);
        if (!Array.isArray(cached?.data)) continue;
        for (const alert of collectUpcomingAlerts(intervalsForQueues(cached.data, [target.queue]))) {
          const existing = found.get(alert.key);
          // Две закладки на ту же чергу дают один ключ: подпись оставляем ту, что есть, а
          // «безымянную» цель из «моїх черг» дописываем, если она пришла первой.
          if (!existing || (!existing.label && target.label)) found.set(alert.key, { alert, label: target.label });
        }
      }

      const pending = filterUnnotified([...found.values()].map((item) => item.alert));
      if (pending.length === 0) return;

      void (async () => {
        const shown: OutageAlert[] = [];
        for (const alert of pending) {
          const label = found.get(alert.key)?.label || t('alerts.queueFallback', { queue: alert.queue });
          const title =
            alert.kind === 'starting'
              ? t('alerts.soonTitle', { minutes: alert.minutesLeft })
              : t('alerts.backTitle', { minutes: alert.minutesLeft });
          const body = t(alert.kind === 'starting' ? 'alerts.soonBody' : 'alerts.backBody', {
            label,
            time: formatKyivTime(alert.at),
          });
          // Помечаем показанным только то, что реально появилось: иначе предупреждение,
          // которое не удалось доставить, больше не повторится.
          if (await showLocalNotification({ title, body, tag: alert.key })) shown.push(alert);
        }
        markNotified(shown);
      })();
    };

    check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') check();
    }, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // currentRegion нужен как пересборка списка целей: «мої черги» относятся к текущей области.
  }, [support, currentRegion, t]);

  return { support, enable };
}
