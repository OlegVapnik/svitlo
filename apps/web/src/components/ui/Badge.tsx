import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Бейдж-«пилюля». Тоны (success/warning/info/danger) берутся из токенов, поэтому в тёмной теме
 * цвета автоматически становятся светлее — раньше жёсткие emerald/amber ломали контраст.
 * Старые имена вариантов (destructive) сохранены: их используют карточки отключений.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-5 transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        outline: 'border-border bg-transparent text-foreground',
        danger: 'border-transparent bg-destructive text-destructive-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        success: 'border-transparent bg-success text-success-foreground',
        info: 'border-transparent bg-info text-info-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  // span, а не div: бейдж почти всегда стоит внутри строки текста (карточка отключения).
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
