import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { useRegion } from '../hooks/useRegion.js';
import { useRegionQueue } from '../hooks/useRegionQueue.js';
import { useQueues, useUpcomingGroupOutages } from '../api/queries.js';
import { GroupMatrix } from '../components/monitor/GroupMatrix.js';
import { hapticTick } from '../lib/haptics.js';

/**
 * Раздел «Моніторинг»: обзор групп области.
 *
 * Решение владельца (2026-10-26): сегменты «Відключення» и «Події» вырезаны вместе с их
 * страницами — раздел показывает только матрицу/плитки групп. Бывшие адреса /outages и
 * /incidents продолжают редиректить сюда (см. nav-items LEGACY_ROUTES).
 */

export const MonitorPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion, currentRegionData } = useRegion();

  const { data: queuesData } = useQueues(currentRegionData.cpu);
  const { data: upcomingData } = useUpcomingGroupOutages(currentRegionData.cpu, 2);

  const queues = queuesData?.data ?? [];
  const outages = upcomingData?.data ?? [];

  // Активная очередь области: та же закладка, что на главной. Матрица подсвечивает её строку
  // и делает кликом по любой другой строке.
  const availableQueues = useMemo(() => {
    const fromCatalog = currentRegionData.queues ?? [];
    return fromCatalog.length > 0 ? fromCatalog : queues.map((item) => item.queue);
  }, [currentRegionData.queues, queues]);
  const { selectedQueue, selectQueue } = useRegionQueue(currentRegion, availableQueues);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          <Activity className="mr-1.5 inline h-5 w-5 align-text-bottom text-primary" aria-hidden />
          {t('nav.monitor')}
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('monitor.subtitle')}</p>
      </header>

      <GroupMatrix
        queues={queues}
        outages={outages}
        selectedQueue={selectedQueue}
        onQueueSelect={(queue) => {
          hapticTick('select');
          selectQueue(queue);
        }}
      />
    </div>
  );
};
