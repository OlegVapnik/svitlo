import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Pencil, RotateCcw, Star, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Badge } from '../ui/Badge.js';
import { PlaceIconBadge, PlaceNameEditor } from './PlaceNameEditor.js';
import { useBookmarks } from '../../hooks/useBookmarks.js';
import { useRegion } from '../../hooks/useRegion.js';
import { useQueues } from '../../api/queries.js';
import { setStoredQueueForRegion } from '../../lib/region-queue.js';
import { hapticTick } from '../../lib/haptics.js';
import { cn } from '../../lib/cn.js';
import type { PlaceIcon, SavedPlace } from '../../lib/saved-places.js';
import { MAX_SAVED_PLACES } from '../../lib/saved-places.js';

/**
 * Список збережених місць на екрані пошуку адреси: тут їх видно всі, з повним набором дій.
 *
 * Чипи на головній — швидкий перемикач, тому там лише перехід і видалення. Перейменування,
 * зміна іконки, порядок і головне місце живуть саме тут: на головній вони перетворили б
 * кожен чип на панель керування.
 */
export const SavedPlacesSection: React.FC = () => {
  const { t } = useTranslation();
  const { places, canAdd, removeBookmark, restoreBookmark } = useBookmarks();
  const [undo, setUndo] = useState<{ place: SavedPlace; index: number } | null>(null);
  const undoTimer = useRef<number | null>(null);

  const handleDelete = useCallback(
    (place: SavedPlace) => {
      const removed = removeBookmark(place.id);
      if (!removed) return;
      setUndo(removed);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      // Пʼять секунд — достатньо, щоб помітити помилку й повернути, але банер не висить вічно.
      undoTimer.current = window.setTimeout(() => setUndo(null), 5000);
    },
    [removeBookmark],
  );

  const handleUndo = () => {
    if (!undo) return;
    restoreBookmark(undo.place, undo.index);
    setUndo(null);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
  };

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-card p-4">
      <header className="space-y-0.5">
        <h2 className="text-sm font-semibold text-foreground">{t('places.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('places.subtitle')}</p>
      </header>

      {places.length === 0 ? (
        <div className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">{t('places.emptyTitle')}</p>
          <p className="mt-0.5">{t('places.emptyDesc')}</p>
        </div>
      ) : (
        <ul aria-label={t('places.listLabel')} className="space-y-2">
          {places.map((place, index) => (
            <SavedPlaceRow
              key={place.id}
              place={place}
              isFirst={index === 0}
              isLast={index === places.length - 1}
              onDelete={() => handleDelete(place)}
            />
          ))}
        </ul>
      )}

      {!canAdd && (
        <p className="text-xs font-semibold text-warning">
          {t('places.limit', { max: MAX_SAVED_PLACES })}
        </p>
      )}

      {undo && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-container-high px-3 py-2 text-xs text-on-surface"
        >
          <span>{t('places.deleted', { label: undo.place.label })}</span>
          <Button type="button" size="sm" variant="outline" onClick={handleUndo} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t('places.undo')}
          </Button>
        </div>
      )}
    </section>
  );
};

const SavedPlaceRow: React.FC<{
  place: SavedPlace;
  isFirst: boolean;
  isLast: boolean;
  onDelete: () => void;
}> = ({ place, isFirst, isLast, onDelete }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setRegion, regions } = useRegion();
  const { renameBookmark, setBookmarkIcon, setBookmarkQueue, setPrimaryBookmark, moveBookmark } =
    useBookmarks();
  const { data: queuesResponse } = useQueues(place.regionCpu);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(place.label);
  const [draftIcon, setDraftIcon] = useState<PlaceIcon>(place.icon);
  const [draftQueue, setDraftQueue] = useState(place.queue);

  const regionName =
    regions.find((region) => region.cpu === place.regionCpu)?.nameUa ?? place.regionCpu;
  const queues = queuesResponse?.data.map((item) => item.queue) ?? [];
  const address = [place.settlementName, place.streetName, place.house]
    .filter(Boolean)
    .join(', ');

  /** Місце застосовується глобально: область + її черга, і одразу перехід на головну. */
  const applyPlace = () => {
    hapticTick('confirm');
    setRegion(place.regionCpu);
    setStoredQueueForRegion(place.regionCpu, place.queue);
    navigate('/');
  };

  const startEditing = () => {
    setDraftLabel(place.label);
    setDraftIcon(place.icon);
    setDraftQueue(place.queue);
    setEditing(true);
    hapticTick('tick');
  };

  const saveEditing = () => {
    renameBookmark(place.id, draftLabel);
    setBookmarkIcon(place.id, draftIcon);
    if (draftQueue !== place.queue) setBookmarkQueue(place.id, draftQueue);
    setEditing(false);
    hapticTick('confirm');
  };

  return (
    <li
      className={cn(
        'rounded-2xl border p-3',
        place.isPrimary ? 'border-primary/40 bg-primary-container/20' : 'border-border',
      )}
    >
      {editing ? (
        <div className="space-y-3">
          <PlaceNameEditor
            label={draftLabel}
            icon={draftIcon}
            autoFocus
            onLabelChange={setDraftLabel}
            onIconChange={setDraftIcon}
            onSubmit={saveEditing}
            onCancel={() => setEditing(false)}
            submitLabel={t('places.done')}
          />
          {queues.length > 0 && (
            <label className="block space-y-1.5 text-xs font-semibold text-foreground">
              {t('places.changeQueue')}
              <select
                value={draftQueue}
                onChange={(event) => setDraftQueue(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm font-semibold text-foreground"
              >
                {(queues.includes(draftQueue) ? queues : [draftQueue, ...queues]).map((queue) => (
                  <option key={queue} value={queue}>
                    {t('outages.queueNumber', { queue })}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={applyPlace}
            title={t('places.switchHint')}
            className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-xl px-0.5 text-left transition-colors hover:bg-muted/40 active:scale-99"
          >
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface">
              <PlaceIconBadge icon={place.icon} />
            </span>
            <span className="min-w-0 space-y-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-bold text-foreground">{place.label}</span>
                {place.isPrimary && (
                  <Badge variant="default" className="text-[10px]">
                    {t('places.primary')}
                  </Badge>
                )}
                <Badge variant="outline" className="font-mono text-[10px] tabular">
                  {t('outages.queueNumber', { queue: place.queue })}
                </Badge>
              </span>
              <span className="block text-xs text-muted-foreground">
                {regionName}
                {address ? ` · ${address}` : ` · ${t('places.addressUnknown')}`}
              </span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
            <RowAction
              label={t('places.moveUp')}
              disabled={isFirst}
              onClick={() => moveBookmark(place.id, -1)}
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </RowAction>
            <RowAction
              label={t('places.moveDown')}
              disabled={isLast}
              onClick={() => moveBookmark(place.id, 1)}
            >
              <ArrowDown className="h-4 w-4" aria-hidden />
            </RowAction>
            <RowAction label={t('places.rename')} onClick={startEditing}>
              <Pencil className="h-4 w-4" aria-hidden />
            </RowAction>
            <RowAction
              label={t('places.makePrimary')}
              disabled={place.isPrimary}
              active={place.isPrimary}
              onClick={() => {
                hapticTick('select');
                setPrimaryBookmark(place.id);
              }}
            >
              <Star className={cn('h-4 w-4', place.isPrimary && 'fill-current')} aria-hidden />
            </RowAction>
            <RowAction label={t('places.delete')} destructive onClick={onDelete}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </RowAction>
          </div>
        </div>
      )}
    </li>
  );
};

const RowAction: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled = false, active = false, destructive = false, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors',
      'hover:bg-surface-container-high disabled:opacity-30 disabled:hover:bg-transparent',
      active && 'text-primary',
      destructive && 'hover:text-destructive',
    )}
  >
    {children}
  </button>
);
