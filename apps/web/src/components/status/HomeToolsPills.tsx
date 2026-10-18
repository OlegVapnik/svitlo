import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, BatteryCharging, type LucideIcon } from 'lucide-react';
import type { DaySchedule } from '../../lib/day-schedule.js';
import { hapticTick } from '../../lib/haptics.js';
import { cn } from '../../lib/cn.js';
import { PowerWindowPlanner } from './PowerWindowPlanner.js';
import { QueueCompareBar } from '../schedule/QueueCompareBar.js';

/**
 * Компактні інструменти під 24-годинним графіком головної.
 *
 * Чому пігулки, а не дві картки одна під одною: планувальник приладів і порівняння черг — це
 * відповіді на різні питання, і одночасно їх не читають. Розгорнуті обидві картки зсували
 * «швидкі дії» за межі першого екрана телефона, тож людина бачила або графік, або інструменти.
 * Тут активною є щонабільше одна панель, решта — один рядок пігулок висотою 44px.
 *
 * Стан живе в компоненті (не в URL): це допоміжні панелі, і посилання «відкрий саме
 * порівняння черг» нікому не потрібне. Повторний тап по активній пігулці згортає панель.
 */
type ToolId = 'devices' | 'compare';

export interface HomeToolsPillsProps {
  /** cpu області поточної групи. */
  region: string;
  /** Код групи, для якої показуємо інструменти. */
  queue: string;
  /** Київська дата з героя — та сама, що в таймлайні. */
  date: string;
  /** Сьогодні й завтра для планувальника приладів. */
  days: readonly DaySchedule[];
  /** Поточний момент, оновлюється батьком раз на хвилину. */
  now: Date;
  className?: string;
}

interface ToolDefinition {
  id: ToolId;
  label: string;
  icon: LucideIcon;
}

export const HomeToolsPills: React.FC<HomeToolsPillsProps> = ({
  region,
  queue,
  date,
  days,
  now,
  className,
}) => {
  const { t } = useTranslation();
  const [active, setActive] = useState<ToolId | null>(null);

  if (!queue) return null;

  const tools: ToolDefinition[] = [
    { id: 'devices', label: t('tools.devices'), icon: BatteryCharging },
    { id: 'compare', label: t('tools.compare'), icon: ArrowLeftRight },
  ];

  const panelLabel = active === 'devices' ? t('tools.devices') : t('tools.compare');

  return (
    <section className={cn('space-y-2.5', className)} aria-label={t('tools.title')}>
      <div className="flex flex-wrap gap-2">
        {tools.map((tool) => {
          const isActive = active === tool.id;
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              aria-pressed={isActive}
              aria-expanded={isActive}
              aria-controls={isActive ? 'home-tools-panel' : undefined}
              onClick={() => {
                hapticTick('select');
                setActive((current) => (current === tool.id ? null : tool.id));
              }}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-hairline bg-surface-container-high/50 text-on-surface-variant hover:bg-surface-container-highest',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {tool.label}
            </button>
          );
        })}
      </div>

      {active && (
        <div id="home-tools-panel" role="region" aria-label={panelLabel}>
          {active === 'devices' ? (
            <PowerWindowPlanner days={days} now={now} />
          ) : (
            <QueueCompareBar region={region} queue={queue} date={date} embedded />
          )}
        </div>
      )}
    </section>
  );
};
