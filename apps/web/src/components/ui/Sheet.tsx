import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/**
 * Bottom sheet: выезжающая снизу шторка.
 *
 * Сделано вручную, без библиотеки ради анимаций: framer-motion весит ~45 kB gzip и ради
 * одного жеста тянет в стартовый чанк, который обязан остаться меньше 200 kB. Здесь только
 * CSS-переход и небольшой state — этого хватает для жеста, фокус-трапа и Esc.
 *
 * Клавиатура и скринридер: роль dialog, aria-modal, ловушка фокуса и возврат фокуса на
 * элемент, который шторку открыл. Без этого шторка остаётся «висящим» слоем поверх
 * страницы, и с клавиатуры до неё не добраться.
 */

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({ open, onClose, title, children }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  // Откуда открыли — туда же вернём фокус при закрытии, иначе он пропадает на body.
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // Фокус-трап: пока шторка открыта, фокус не должен уйти на страницу под ней.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // Фокус внутрь — на титул, чтобы первый Tab не улетел обратно на страницу.
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('[data-autofocus], button, a, input')?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  // Жест вниз закрывает. Тянем только за «ручку» сверху: если тянуть за содержимое,
  // прокрутка внутри шторки перестанет работать.
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY;
    const handleMove = (move: PointerEvent) => {
      const delta = move.clientY - startY;
      setDragOffset(delta > 0 ? delta : 0);
    };
    const handleUp = (up: PointerEvent) => {
      const delta = up.clientY - startY;
      if (delta > 110) onClose();
      setDragOffset(0);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Закрити"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ transform: dragOffset ? `translateY(${dragOffset}px)` : undefined }}
        className={cn(
          'relative z-10 max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border border-border',
          'bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-pop',
          'animate-rise sm:max-w-lg sm:rounded-3xl',
        )}
      >
        <div
          onPointerDown={onPointerDown}
          className="mx-auto mb-3 flex h-6 w-full max-w-30 cursor-grab touch-none justify-center"
          aria-hidden
        >
          <span className="h-1.5 w-full rounded-full bg-muted-foreground/40" />
        </div>

        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="-mr-1 inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
};
