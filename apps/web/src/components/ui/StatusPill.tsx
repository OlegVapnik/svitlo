import React from 'react';
import { Clock, FileQuestion, Zap, ZapOff, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import type { NetworkState } from './StatusDot.js';

/**
 * Пилл состояния сети — строгий «стеклянный» бейдж: полупрозрачная заливка, грань 1px,
 * светящаяся точка и векторная иконка.
 *
 * ЧТО ЗДЕСЬ БЫЛО И ПОЧЕМУ УБРАНО. Раньше статус рисовался вращающимися M3-фигурами
 * (scallop / клевер / полигон) плюс гигантский контур фигуры на пол-карточки. Выглядело это
 * как декорация, а не как прибор: фигуры спорили с цифрами, на телефоне занимали четверть
 * блока, и в списках десяток анимаций ел батарею. Роль «второго сигнала» (не только цвет)
 * теперь несут иконка состояния (Zap / Clock / ZapOff) и точка — они читаются и на солнце,
 * и при дальтонизме, и стоят ровно один ряд пикселей.
 *
 * ОТКУДА ЦВЕТ. Из токенов состояния (--md-status*), а не из пропа: и бейдж, и таймер, и
 * полоса прогресса читают один и тот же `data-power-state`, поэтому разойтись не могут.
 */
const ICONS: Record<NetworkState, LucideIcon> = {
  on: Zap,
  soon: Clock,
  off: ZapOff,
  unknown: FileQuestion,
};

export interface StatusPillProps {
  state: NetworkState;
  label: string;
  /** Точка пульсирует: единственный «живой» элемент шапки — видно, что данные приходят. */
  pulse?: boolean;
  className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ state, label, pulse = false, className }) => {
  const Icon = ICONS[state];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-status-border bg-status-soft px-3 py-1 text-xs font-semibold text-status-text',
        className,
      )}
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full bg-status shadow-[0_0_8px_currentColor]',
          pulse && 'animate-pulse-soft',
        )}
        aria-hidden
      />
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
      {label}
    </span>
  );
};
