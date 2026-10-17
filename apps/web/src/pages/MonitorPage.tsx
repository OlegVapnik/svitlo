import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Activity, CalendarDays, Zap } from 'lucide-react';
import { useRegion } from '../hooks/useRegion.js';
import { useRegionQueue } from '../hooks/useRegionQueue.js';
import { useQueues, useUpcomingGroupOutages } from '../api/queries.js';
import { GroupMatrix } from '../components/monitor/GroupMatrix.js';
import { OutagesPage } from './OutagesPage';
import { IncidentsPage } from './IncidentsPage';
import { hapticTick } from '../lib/haptics.js';
import { cn } from '../lib/cn.js';

/**
 * Раздел «Моніторинг»: группы области, отключения и события.
 *
 * Три бывших раздела (/queues, /outages, /incidents) стали сегментами одного экрана.
 * Отдельными пунктами меню они выглядели тремя разными приложениями: у каждого был свой
 * заголовок и своя навигация, хотя отвечали на один вопрос — «что происходит с светом».
 *
 * Сегмент живёт в адресе (?tab=outages), а не в состоянии: иначе ссылку на конкретный
 * сегмент нельзя отправить другому человеку, а кнопка «Назад» возвращала бы на предыдущий
 * экран вместо предыдущего сегмента.
 */

const SEGMENTS = [
  { id: 'groups', labelKey: 'nav.monitorGroups', Icon: CalendarDays },
  { id: 'outages', labelKey: 'nav.monitorOutages', Icon: Zap },
  { id: 'incidents', labelKey: 'nav.monitorIncidents', Icon: Activity },
] as const;

type SegmentId = (typeof SEGMENTS)[number]['id'];

export const MonitorPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion, currentRegionData } = useRegion();
  const [params, setParams] = useSearchParams();

  const requested = params.get('tab');
  const segment: SegmentId = SEGMENTS.some((item) => item.id === requested)
    ? (requested as SegmentId)
    : 'groups';

  const { data: queuesData } = useQueues(currentRegionData.cpu);
  const { data: upcomingData } = useUpcomingGroupOutages(currentRegionData.cpu, 2);

  const queues = queuesData?.data ?? [];
  const outages = upcomingData?.data ?? [];

  // Активная очередь области: та же закладка, что на главной. Матрица подсвечивает её строку
  // и делает кликом по любой другой строке — без перехода на экран «Відключення».
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

      {/* Сегменты крупные (44px) и ведут себя как табы: один активен, остальные видны. */}
      <div role="tablist" aria-label={t('nav.monitor')} className="inline-flex rounded-full border border-border bg-card p-0.5">
        {SEGMENTS.map(({ id, labelKey, Icon }) => {
          const active = segment === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                hapticTick('select');
                setParams(id === 'groups' ? {} : { tab: id }, { replace: true });
              }}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      {segment === 'groups' && (
        <GroupMatrix
          queues={queues}
          outages={outages}
          selectedQueue={selectedQueue}
          onQueueSelect={selectQueue}
          onSelect={(queue) => {
            selectQueue(queue);
            setParams({ tab: 'outages' }, { replace: true });
          }}
        />
      )}
      {segment === 'outages' && <OutagesPage embedded />}
      {segment === 'incidents' && <IncidentsPage embedded />}
    </div>
  );
};
