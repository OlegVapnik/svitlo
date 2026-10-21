import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  className?: string;
}

/**
 * Пустое состояние: иконка, заголовок, объяснение. Раньше это была одна строка с `any`-пропсами
 * без стилей — на «Контакти» и в списках выглядело как сломанная страница (skills/frontend-ui-change).
 */
export const EmptyState = ({ title, description, icon: Icon = Inbox, className }: EmptyStateProps) => (
  <div
    className={[
      'flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 px-6 py-10 text-center',
      className ?? '',
    ].join(' ')}
  >
    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
      <Icon className="h-5 w-5" aria-hidden />
    </span>
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    {description && <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>}
  </div>
);
