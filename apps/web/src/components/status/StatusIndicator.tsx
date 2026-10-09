import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';

interface StatusIndicatorProps {
  level?: 'stable' | 'warning' | 'emergency';
  message?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  level = 'stable',
  message,
}) => {
  const { t } = useTranslation();

  const configs = {
    stable: {
      bg: 'bg-emerald-500/10 dark:bg-emerald-950/30',
      border: 'border-emerald-500/30 dark:border-emerald-800/50',
      text: 'text-emerald-700 dark:text-emerald-300',
      dot: 'bg-emerald-500',
      ping: 'bg-emerald-400',
      icon: CheckCircle2,
      title: t('status.stable', 'Енергосистема працює стабільно'),
      defaultMsg: 'Дефіциту потужності не зафіксовано. Відключення відбуваються за плановим графіком.',
    },
    warning: {
      bg: 'bg-amber-500/10 dark:bg-amber-950/30',
      border: 'border-amber-500/30 dark:border-amber-800/50',
      text: 'text-amber-700 dark:text-amber-300',
      dot: 'bg-amber-500',
      ping: 'bg-amber-400',
      icon: AlertTriangle,
      title: t('status.warning', 'Можливі тимчасові обмеження'),
      defaultMsg: 'Підвищене навантаження на систему. Будь ласка, ощадливо споживайте електроенергію.',
    },
    emergency: {
      bg: 'bg-red-500/10 dark:bg-red-950/30',
      border: 'border-red-500/30 dark:border-red-800/50',
      text: 'text-red-700 dark:text-red-300',
      dot: 'bg-red-500',
      ping: 'bg-red-400',
      icon: AlertOctagon,
      title: t('status.emergency', 'Аварійна ситуація в системі'),
      defaultMsg: 'Застосовано екстрені відключення за розпорядженням НЕК «Укренерго». Графіки не діють.',
    },
  };

  const current = configs[level] || configs.stable;
  const Icon = current.icon;

  return (
    <div
      className={`rounded-2xl border ${current.border} ${current.bg} p-4 sm:p-5 transition-all`}
    >
      <div className="flex items-start gap-3.5">
        <div className="relative mt-1 shrink-0">
          <span className={`flex h-3.5 w-3.5 relative`}>
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full ${current.ping} opacity-75`}
            />
            <span
              className={`relative inline-flex rounded-full h-3.5 w-3.5 ${current.dot}`}
            />
          </span>
        </div>

        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className={`font-bold text-base sm:text-lg ${current.text}`}>
              {current.title}
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">
            {message || current.defaultMsg}
          </p>
        </div>
      </div>
    </div>
  );
};