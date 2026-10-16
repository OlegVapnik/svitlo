import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Plus, RefreshCw, Pencil, Star, Trash2 } from 'lucide-react';
import { AddressCombobox } from '../components/search/AddressCombobox.js';
import type { QueueSummary } from '@svitlo/shared';
import { Card, CardContent } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Select } from '../components/ui/Select.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { QueuePlacesChips } from '../components/queue/QueuePlacesChips.js';
import { QueueScheduleBar } from '../components/schedule/QueueScheduleBar.js';
import { useBookmarks } from '../hooks/useBookmarks.js';
import { useRegion } from '../hooks/useRegion.js';
import { useQueueSchedule, useQueues } from '../api/queries.js';
import { isQueueCode, normalizeQueueCode } from '../lib/queue.js';

function kyivDate(offsetDays = 0): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const base = new Date(Date.UTC(pick('year'), pick('month') - 1, pick('day') + offsetDays));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}

/**
 * «Мої черги»: список черг собирает пользователь, но код очереди выбирается из реальных данных —
 * выпадающий список наполняется из GET /api/v1/queues?region=... (слоты графика + привязки улиц).
 * Ручного ввода кода и зашитой '2/2' больше нет: выбрать можно только существующую чергу.
 */
export const QueueSchedulePage: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion, currentRegionData } = useRegion();
  const { bookmarks, addBookmark, removeBookmark, setPrimaryBookmark, renameBookmark } = useBookmarks();
  const { data: queuesData, isLoading: queuesLoading } = useQueues(currentRegion);
  // Выбор группы — только из списка групп области. Раньше поле требовало ещё и ручной ввод кода
  // очереди, а подсказка по улице ничего не определяла (в базе 0 привязок «улица → черга»),
  // поэтому добавить группу было невозможно. Название группы задаёт сам человек.
  const [newQueue, setNewQueue] = useState('');
  const [newLabel, setNewLabel] = useState(() => localStorage.getItem('myQueueLabel') || '');
  const [day, setDay] = useState<0 | 1>(0);
  const date = useMemo(() => kyivDate(day), [day]);
  const knownQueues = queuesData?.data ?? [];
  const code = normalizeQueueCode(newQueue);
  const codeValid = isQueueCode(code);
  const canAdd = codeValid;

  /** Подпись варианта-подсказки: сколько улиц закреплено и на какую дату есть график. */
  function queueOptionLabel(item: QueueSummary): string {
    const parts: string[] = [];
    if (item.streets > 0) parts.push(t('queues.streetsCount', { n: item.streets }));
    if (item.lastDate) parts.push(t('queues.scheduleDate', { date: item.lastDate }));
    if (parts.length > 0) return `${item.queue} — ${parts.join(' · ')}`;
    // Группа из опубликованного ГПВ без единого часа отключения: «графік не імпортовано» про неё —
    // неправда, график как раз есть. Флаг приходит из API (`QueueSummary.covered`).
    if (item.covered) return `${item.queue} — ${t('schedule.allClearTitle')}`;
    return `${item.queue} — ${t('queues.noSchedule')}`;
  }

  const handleAdd = () => {
    if (!canAdd) return;
    localStorage.setItem('myQueueLabel', newLabel.trim());
    // Закладка группы. Название — то, что ввёл человек («Дім», «Робота»), иначе область+код.
    addBookmark({
      label: newLabel.trim() || `${currentRegionData.nameUa || currentRegion} · ${code}`,
      regionCpu: currentRegion,
      queue: code,
    });
    setNewQueue('');
    setNewLabel('');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-16 md:pb-6">
      <header className="space-y-0.5">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {t('queues.title')}
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">
          {currentRegionData.nameUa ? `${currentRegionData.nameUa} · ` : ''}
          {t('queues.subtitle')}
        </p>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="queue-label" className="text-xs font-semibold text-foreground">
                {t('queues.groupNameLabel')}
              </label>
              {/* Своё название группы («Дім», «Робота»). Переименовать закладку можно в любой
                  момент — название здесь лишь значение по умолчанию. */}
              <input
                id="queue-label"
                type="text"
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
                placeholder={t('queues.groupNamePlaceholder')}
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="queue-code" className="text-xs font-semibold text-foreground">
                {t('queues.queueLabel')}
              </label>
              {/* Выпадающий список только реальных черг (GET /api/v1/queues) — без ручного ввода выдуманных кодов. */}
              <Select
                id="queue-code"
                value={newQueue}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                  setNewQueue(event.target.value)
                }
                disabled={knownQueues.length === 0}
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">{t('queues.selectQueue')}</option>
                {knownQueues.map((item) => (
                  <option key={item.queue} value={item.queue}>
                    {queueOptionLabel(item)}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground" role="status">
                {queuesLoading
                  ? t('queues.loading')
                  : knownQueues.length > 0
                    ? t('queues.listFromData', { n: knownQueues.length })
                    : t('regions.emptyQueues')}
              </p>
              {newQueue.trim().length > 0 && !codeValid && (
                <p role="alert" className="text-xs text-destructive">
                  {t('queues.invalidCode')}
                </p>
              )}
            </div>
          </div>
          <Button className="gap-2" disabled={!canAdd} onClick={handleAdd}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('queues.add')}
          </Button>
        </CardContent>
      </Card>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('queues.chooseDate')}
      >
        <Button
          variant={day === 0 ? 'default' : 'outline'}
          onClick={() => setDay(0)}
          className="gap-2"
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
          {t('queues.today')}
        </Button>
        <Button
          variant={day === 1 ? 'default' : 'outline'}
          onClick={() => setDay(1)}
          className="gap-2"
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
          {t('queues.tomorrow')}
        </Button>
        <span className="tabular self-center text-sm text-muted-foreground">{date}</span>
      </div>

      {bookmarks.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t('queues.emptyTitle')}
          description={t('queues.emptyDesc')}
        />
      ) : (
        <div className="space-y-4">
          {bookmarks.map((bm) => (
            <BookmarkQueueCard
              key={bm.id}
              bookmark={bm}
              date={date}
              onRemove={() => removeBookmark(bm.id)}
              onSetPrimary={() => setPrimaryBookmark(bm.id)}
              onRename={(label) => renameBookmark(bm.id, label)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

type QueueCardProps = {
  regionCpu: string;
  queue: string;
  street: string;
  date: string;
  isPrimary: boolean;
  onRemove: () => void;
  onSetPrimary: () => void;
  /** Прив'язка группы: населённые пункты и улицы этой области (из GET /api/v1/queues). */
  settlements?: string[];
  streetNames?: string[];
  /** Перейменувати групу («Дім» → «Офіс»). */
  onRename: (label: string) => void;
};

/**
 * Обгортка закладки: підтягує прив'язку «НП/вулиці → група» для ОБЛАСТИ САМОЇ закладки.
 *
 * У закладок можуть бути різні області, а черга «2/2» у Чернігівській і Львівській — різні
 * групи, тому список груп треба питати per-region, а не один раз для поточної області.
 */
const BookmarkQueueCard: React.FC<{
  bookmark: { regionCpu: string; queue: string; label: string; streetName?: string; isPrimary?: boolean };
  date: string;
  onRemove: () => void;
  onSetPrimary: () => void;
  onRename: (label: string) => void;
}> = ({ bookmark, date, onRemove, onSetPrimary, onRename }) => {
  const { data: regionQueues } = useQueues(bookmark.regionCpu);
  const places = (regionQueues?.data ?? []).find((item) => item.queue === bookmark.queue);
  return (
    <QueueScheduleCard
      regionCpu={bookmark.regionCpu}
      queue={bookmark.queue}
      street={bookmark.streetName ?? bookmark.label}
      date={date}
      isPrimary={bookmark.isPrimary ?? false}
      onRemove={onRemove}
      onSetPrimary={onSetPrimary}
      onRename={onRename}
      settlements={places?.settlements ?? []}
      streetNames={places?.streetNames ?? []}
    />
  );
};

/**
 * Картка однієї черги з з СОЮ областю (закладка). Раніше черга запитувала графік по
 * глобальній поточній області — з-за этого черги різних областей показували хибні дані.
 * Теперь `regionCpu` берётся із закладки, і графік запитуется саме для єтої області.
 */
const QueueScheduleCard: React.FC<QueueCardProps> = ({
  regionCpu,
  queue,
  street,
  date,
  isPrimary,
  onRemove,
  onSetPrimary,
  settlements = [],
  streetNames = [],
  onRename,
}) => {
  const { t } = useTranslation();
  // Режим перейменування: показываем поле ввода прямо в карточке, чтобы не искать диалог.
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(street);
  const { data, isLoading, isFetching, isError, refetch } = useQueueSchedule(
    queue,
    date,
    regionCpu,
  );
  // useQueueSchedule отдаёт конверт { data } — график лежит в .data.
  // Без ?. после data ответ без конверта { data: … } ронял страницу вместо пустого графика.
  const intervals = data?.data?.intervals ?? [];

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {editing ? (
              <input
                type="text"
                value={draftLabel}
                autoFocus
                onChange={(event) => setDraftLabel(event.target.value)}
                onBlur={() => {
                  onRename(draftLabel);
                  setEditing(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onRename(draftLabel);
                    setEditing(false);
                  }
                  if (event.key === 'Escape') setEditing(false);
                }}
                aria-label={t('queues.renameGroup')}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm font-semibold shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraftLabel(street);
                  setEditing(true);
                }}
                aria-label={t('queues.renameGroup')}
                title={t('queues.renameGroup')}
                className="inline-flex items-center gap-1.5 truncate rounded-md text-sm font-semibold text-foreground hover:bg-muted"
              >
                {street || t('queues.streetFallback')}
                <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            )}
            <Badge variant="info">
              {t('queues.queueLabel')} {queue}
            </Badge>
            {isPrimary && (
              <Badge variant="default" className="text-[11px]">
                {t('queues.primary')}
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            {!isPrimary && (
              <Button
                size="sm"
                variant="outline"
                onClick={onSetPrimary}
                aria-label={t('queues.setPrimary')}
                className="gap-1.5"
              >
                <Star className="h-3.5 w-3.5" aria-hidden />
                {t('queues.setPrimary')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={isFetching}
              onClick={() => void refetch()}
              className="gap-1.5"
            >
              <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
              {isFetching ? t('queues.loading') : t('queues.refresh')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRemove}
              aria-label={`${t('queues.delete')}: ${queue}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
        <p className="tabular text-xs text-muted-foreground">{date}</p>
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (
          <QueueScheduleBar intervals={intervals} date={date} allClear={data?.data?.allClear === true} />
        )}
        {/* Що входить у цю групу в її області. Джерело географії груп не надсилає — тоді
            блок просто не малюється, без вигаданих районів. */}
        <QueuePlacesChips settlements={settlements} streetNames={streetNames} />
        {isError && (
          <p role="alert" className="text-xs text-destructive">
            {t('queues.error')}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
