import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BatteryCharging, BatteryLow, type LucideIcon } from 'lucide-react';
import { formatMinutesUk } from '../../lib/scheduleWindow.js';

/** Состояние сети в терминах героя: `soon` — то же, что `warning` в usePowerState. */
type TipState = 'on' | 'off' | 'soon' | 'warning' | 'unknown';

export interface HeroContextTipProps {
  state: TipState;
  /** Минут до возврата света (идёт отключение). */
  backInMinutes: number | null;
  /** Конец текущего отключения (ISO) — из него берётся время «о HH:MM». */
  nextBoundaryAt: string | null;
}

/** Время интервала в киевской зоне — так же, как показывает оператор. */
function formatTime(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Контекстная подсказка под героем: что человеку делать прямо сейчас.
 *
 * Раньше подсказка была одна на все случаи («зарядити телефон або попрати») и появлялась только
 * при отключении — то есть совет «заряжайте» приходил ровно тогда, когда заряжать нечем.
 * Теперь текст и иконка зависят от состояния: при отключении — до какого часа света не будет,
 * перед отключением — что успеть, при свете — что зарядить. Это единственный блок на главной,
 * который говорит не «что с сетью», а «что делать».
 */
export const HeroContextTip: React.FC<HeroContextTipProps> = ({ state, backInMinutes, nextBoundaryAt }) => {
  const { t } = useTranslation();
  if (state === 'unknown') return null;

  /** Время конца отключения и остаток — оба нужны, чтобы обещание было проверяемым. */
  const boundary = state === 'off' && nextBoundaryAt ? formatTime(nextBoundaryAt) : null;
  const timeLeft = state === 'off' && backInMinutes != null ? formatMinutesUk(backInMinutes) : null;

  const Icon: LucideIcon = state === 'off' ? BatteryLow : state === 'on' ? BatteryCharging : AlertTriangle;
  const text =
    state === 'off'
      ? boundary && timeLeft
        ? t('home.tipOff', { time: boundary, timeLeft })
        : t('home.tipOffNoTime')
      : state === 'on'
        ? t('home.tipOn')
        : t('home.tipSoon');

  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-hairline bg-surface-container-high p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-status-text" strokeWidth={2.2} aria-hidden />
      <p className="text-xs leading-relaxed text-on-surface-variant">{text}</p>
    </div>
  );
};
