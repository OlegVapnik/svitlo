import * as React from 'react';
import { cn } from '@/lib/cn';

/** Плейсхолдер загрузки. Радиус совпадает с карточками, чтобы «скелет» не прыгал при подмене. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-pulse rounded-xl bg-muted/70', className)} {...props} />;
}
