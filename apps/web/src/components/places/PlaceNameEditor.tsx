import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { PLACE_ICON_COMPONENTS, PLACE_ICON_LABEL_KEYS, PlaceIconMark } from './PlaceIcon.js';
import { MAX_PLACE_LABEL_LENGTH, PLACE_ICONS, type PlaceIcon } from '../../lib/saved-places.js';
import { hapticTick } from '../../lib/haptics.js';
import { cn } from '../../lib/cn.js';

export interface PlaceNameEditorProps {
  label: string;
  icon: PlaceIcon;
  onLabelChange: (value: string) => void;
  onIconChange: (icon: PlaceIcon) => void;
  /** Кнопки «Зберегти / Скасувати». Без них редактор працює як інлайн-перейменування. */
  onSubmit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  submitLabel?: string;
  className?: string;
}

/**
 * Поле назви + вибір іконки для збереженого місця.
 *
 * Назва обмежена 24 символами не «щоб було»: чип на головній має фіксовану висоту, і довга
 * назва або обрізалась многоточієм, або ламала рядок. Лічильник показує межу одразу, щоб
 * людина не вперлась у неї мовчки.
 *
 * Іконки — радіогрупа, а не набір кнопок: для скрін-рідера «обрано 3 з 8» зрозуміліше, ніж
 * вісім незалежних перемикачів.
 */
export const PlaceNameEditor: React.FC<PlaceNameEditorProps> = ({
  label,
  icon,
  onLabelChange,
  onIconChange,
  onSubmit,
  onCancel,
  autoFocus = false,
  disabled = false,
  submitLabel,
  className,
}) => {
  const { t } = useTranslation();
  const inputId = useId();

  return (
    <div className={cn('space-y-3', className)}>
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="text-xs font-semibold text-foreground">
          {t('places.nameLabel')}
        </label>
        <input
          id={inputId}
          type="text"
          value={label}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={MAX_PLACE_LABEL_LENGTH}
          placeholder={t('places.namePlaceholder')}
          onChange={(event) => onLabelChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
            if (event.key === 'Escape' && onCancel) {
              event.preventDefault();
              onCancel();
            }
          }}
          className="min-h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm font-semibold text-foreground shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{t('places.nameHint', { max: MAX_PLACE_LABEL_LENGTH })}</span>
          <span className="tabular">
            {label.length}/{MAX_PLACE_LABEL_LENGTH}
          </span>
        </div>
      </div>

      <div role="radiogroup" aria-label={t('places.iconLabel')} className="grid grid-cols-8 gap-1.5">
        {PLACE_ICONS.map((name) => {
          const Icon = PLACE_ICON_COMPONENTS[name];
          const selected = name === icon;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={t(PLACE_ICON_LABEL_KEYS[name])}
              title={t(PLACE_ICON_LABEL_KEYS[name])}
              disabled={disabled}
              onClick={() => {
                hapticTick('select');
                onIconChange(name);
              }}
              className={cn(
                'inline-flex aspect-square min-h-11 items-center justify-center rounded-xl border transition-colors duration-200 ease-m3-expressive-fast',
                selected
                  ? 'border-primary bg-primary-container text-on-primary-container'
                  : 'border-outline-variant/70 bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2.2} aria-hidden />
            </button>
          );
        })}
      </div>

      {(onSubmit || onCancel) && (
        <div className="flex flex-wrap gap-2">
          {onSubmit && (
            <Button
              type="button"
              onClick={onSubmit}
              disabled={disabled}
              className="min-h-11 flex-1 gap-1.5"
            >
              <Check className="h-4 w-4" aria-hidden />
              {submitLabel ?? t('places.done')}
            </Button>
          )}
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={disabled}
              className="min-h-11 gap-1.5"
            >
              <X className="h-4 w-4" aria-hidden />
              {t('places.cancel')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

/** Компактний значок місця для чипів і рядків списку: одна точка правки розміру. */
export const PlaceIconBadge: React.FC<{ icon: PlaceIcon; className?: string }> = ({
  icon,
  className,
}) => <PlaceIconMark icon={icon} className={cn('h-4 w-4 shrink-0', className)} />;
