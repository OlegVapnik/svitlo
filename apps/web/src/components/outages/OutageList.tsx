import React from 'react';
import { useTranslation } from 'react-i18next';
import { OutageCard } from './OutageCard.js';
import { Skeleton } from '../ui/Skeleton.js';
import { EmptyState } from '../common/EmptyState.js';
import { ErrorState } from '../common/ErrorState.js';
import { ZapOff } from 'lucide-react';
import type { Outage } from '@energy-monitor/shared';

interface OutageListProps {
  outages: Outage[];
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}

export const OutageList: React.FC<OutageListProps> = ({
  outages,
  isLoading,
  isError,
  onRetry,
}) => {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-3">
            <div className="flex justify-between items-center">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
          </div>
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
        title={t('outages.noOutages')}
        description={t('outages.noOutagesDesc', 'На вибраний період відключень не заплановано')}
      />
    );
  }

  return (
    <div className="space-y-3">
      {outages.map((outage) => (
        <OutageCard key={outage.id} outage={outage} />
      ))}
    </div>
  );
};