import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';

/**
 * Переключатель темы — одна кнопка: світла ↔ темна.
 *
 * ПОЧЕМУ НЕ ТРИ КНОПКИ. Раньше здесь стоял сегмент «Авто / Світла / Темна» из трёх кнопок по
 * 44px: вместе с логотипом и чипом области он переставал помещаться в ширину телефона, и
 * элементы шапки налезали друг на друга. Режим «Авто» при этом дублировал системную настройку и
 * делал поведение невидимым. Одна кнопка показывает текущую тему иконкой (солнце/луна) и
 * переключает её одним касанием: состояние читается и по иконке, и по aria-pressed, поэтому
 * цвет не единственный сигнал.
 */
export const ThemeToggle = () => {
  const { t } = useTranslation();
  const { theme, setPreference } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? t('theme.toLight') : t('theme.toDark');

  return (
    <button
      type="button"
      onClick={() => setPreference(isDark ? 'light' : 'dark')}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
        'border border-border bg-card text-on-surface-variant transition-colors',
        'hover:bg-surface-container-highest hover:text-on-surface',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {/* Обе иконки стоят в одной точке: смена — кроссфейд, без «моргания» пустого места. */}
      <Sun
        className={cn(
          'absolute h-4 w-4 transition-[opacity,transform] duration-200',
          isDark ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
        )}
        strokeWidth={2.2}
        aria-hidden
      />
      <Moon
        className={cn(
          'absolute h-4 w-4 transition-[opacity,transform] duration-200',
          isDark ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        )}
        strokeWidth={2.2}
        aria-hidden
      />
    </button>
  );
};
