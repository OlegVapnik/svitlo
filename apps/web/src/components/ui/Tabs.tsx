import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Вкладки по паттерну ARIA tabs: role=tablist/tab/tabpanel, aria-selected, управление стрелками
 * влево/вправо. Раньше переключатель вида на странице «Відключення» был набором <button> без
 * ролей — для скринридера это просто три кнопки (skills/frontend-ui-change: prefer ui/Tabs).
 *
 * API контролируемый: значение живёт в родителе (<Tabs value onValueChange>), поэтому состояние
 * можно менять и из других мест (например, из календаря).
 */
interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error(`${component} must be used inside <Tabs>`);
  return context;
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const baseId = React.useId();
  const context = React.useMemo(
    () => ({ value, setValue: onValueChange, baseId }),
    [value, onValueChange, baseId],
  );
  return (
    <TabsContext.Provider value={context}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function TabsList({ children, className, 'aria-label': ariaLabel }: TabsListProps) {
  const { setValue } = useTabsContext('TabsList');

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const triggers = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const currentIndex = triggers.findIndex((trigger) => trigger.getAttribute('aria-selected') === 'true');
    if (currentIndex < 0 || triggers.length === 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === 'ArrowRight'
        ? (currentIndex + 1) % triggers.length
        : (currentIndex - 1 + triggers.length) % triggers.length;
    const next = triggers[nextIndex];
    const nextValue = next?.dataset['value'];
    if (next && nextValue) {
      setValue(nextValue);
      next.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn('flex gap-1 rounded-xl border border-border bg-muted/40 p-1', className)}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const { value: activeValue, setValue, baseId } = useTabsContext('TabsTrigger');
  const selected = activeValue === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-controls={`${baseId}-panel-${value}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-value={value}
      onClick={() => setValue(value)}
      className={cn(
        'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
        selected ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { value: activeValue, baseId } = useTabsContext('TabsContent');
  if (activeValue !== value) return null;
  return (
    <div role="tabpanel" id={`${baseId}-panel-${value}`} aria-labelledby={`${baseId}-tab-${value}`} className={className}>
      {children}
    </div>
  );
}
