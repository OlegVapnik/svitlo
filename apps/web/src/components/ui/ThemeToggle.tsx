import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';

/**
 * Переключатель темы: Авто / Світла / Темна.
 *
 * Три кнопки в ряд, а не иконка-переключатель: режим «Авто» нельзя выразить двумя
 * состояниями, и человек, который выбрал его один раз, не должен его терять. Каждая
 * кнопка — обычная кнопка с aria-pressed, поэтому работает и с клавиатуры.
 *
 * Класс .font-timer НЕ используем: подписи короткие, моноширинный здесь смотрелся бы
 * как чужеродный.
 */
const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'auto', label: 'Авто', Icon: Monitor },
  { value: 'light', label: 'Світла', Icon: Sun },
  { value: 'dark', label: 'Темна', Icon: Moon },
];

export const ThemeToggle = () => {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="group"
      aria-label="Тема оформлення"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setPreference(value)}
            aria-pressed={active}
            title={label}
            className={cn(
              'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5',
              'text-xs font-semibold transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
};
