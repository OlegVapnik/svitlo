import React from 'react';
import { Wrench } from 'lucide-react';

interface Props {
  title: string;
  subtitle?: string;
}

export const MaintenanceNotice: React.FC<Props> = ({
  title,
  subtitle = 'Розділ тимчасово оновлюється та перебуває на технічному обслуговуванні. Спробуйте пізніше.',
}) => {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Wrench className="h-7 w-7" />
      </div>
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-md text-xs text-muted-foreground sm:text-sm">
        {subtitle}
      </p>
      <div className="mt-4 inline-flex items-center rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
        Технічні роботи
      </div>
    </div>
  );
};
