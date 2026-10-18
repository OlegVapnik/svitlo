import React from 'react';
import { useTranslation } from 'react-i18next';
import { ZapOff } from 'lucide-react';
import { OutageCard } from './OutageCard.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Card, CardContent } from '../ui/Card.js';
import { EmptyState } from '../common/EmptyState.js';
import { ErrorState } from '../common/ErrorState.js';
import type { Outage } from '@svitlo/shared';

interface OutageListProps {
  outages: Outage[];
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  /** Честное пустое состояние, когда оператор ещё не опубликовал график на сегодня. */
  emptyTitle?: string;
  emptyDescription?: string;
}

/** Список отключений: скелет совпадает по форме с карточкой, чтобы контент не «прыгал». */
export const OutageList: React.FC<OutageListProps> = ({
  outages,
  isLoading,
  isError,
  onRetry,
  emptyTitle,
  emptyDescription,
}) => {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <Card key={index}>
            <CardContent className="space-y-3 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-6 w-28 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-8 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return <ErrorState onRetry={onRetry} />;
  }

  if (!outages || outages.length === 0) {
    return (
      <EmptyState
        icon={ZapOff}
        title={emptyTitle ?? t('outages.noOutages')}
        description={emptyDescription ?? t('outages.noOutagesDesc')}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* key = id события: подпись (адрес/время) может совпасть у двух записей. */}
      {outages.map((outage) => (
        <OutageCard key={outage.id} outage={outage} />
      ))}
    </div>
  );
};
