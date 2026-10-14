import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Search, Star } from 'lucide-react';
import { useRegion } from '../../hooks/useRegion.js';
import { useBookmarks } from '../../hooks/useBookmarks.js';
import { useAddressLookup } from '../../api/queries.js';
import { QueueScheduleBar } from '../schedule/QueueScheduleBar.js';
import { Button } from '../ui/Button.js';
import { Skeleton } from '../ui/Skeleton.js';
import { cn } from '../../lib/cn.js';
import type { AddressHouseOption, QueueScheduleData } from '@svitlo/shared';

/** Что вернул бэкенд на поиск группы. Формально это `AddressResolveResult` из @svitlo/shared —
 *  здесь повторяем только потому, что мастер держит ответ в состоянии до отрисовки. */
interface ResolveResponse {
  queue: string | null;
  options: AddressHouseOption[];
  reason: 'exact-house' | 'whole-street' | 'whole-settlement' | 'not-found';
  source: string | null;
  schedule: QueueScheduleData | null;
}

/**
 * Пошаговый поиск своей группы ГПВ: область → населённый пункт → улица → дом.
 *
 * Смысл формы: человек не знает номер своей группы, но знает адрес. Мастер задаёт четыре
 * вопроса, каждый следующий опираясь на предыдущий, и в конце показывает группу вместе с
 * графиком на сегодня — то есть закрывает задачу «выключили ли мне» за один визит.
 *
 * Важное: если привязки адреса в базе нет, мастер так и говорит об этом. Номер группы не
 * угадывается по похожей улице — человек сверялся бы с отключением не своей группы.
 */
export const AddressWizard: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion } = useRegion();
  const { addBookmark } = useBookmarks();

  const [settlement, setSettlement] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [result, setResult] = useState<ResolveResponse | null>(null);
  const [saved, setSaved] = useState(false);

  const resolve = useAddressLookup();

  const submit = async () => {
    if (!settlement.trim()) return;
    setSaved(false);
    const found = await resolve.mutateAsync({
      region: currentRegion,
      settlement: settlement.trim(),
      street: street.trim() || undefined,
      house: house.trim() || undefined,
    });
    setResult(found);
  };

  const save = () => {
    if (!result?.queue) return;
    addBookmark({
      label: [settlement, street, house].filter(Boolean).join(', '),
      regionCpu: currentRegion,
      settlementName: settlement.trim(),
      streetName: [street, house].filter(Boolean).join(' ').trim() || undefined,
      queue: result.queue,
    });
    setSaved(true);
  };

  const queue = result?.queue ?? null;
  // Выносим в локальные константы: переменная состояния внутри JSX не сужается типами,
  // и TypeScript ругается на возможный null.
  const schedule = result?.schedule ?? null;
  const source = result?.source ?? null;
  const intervals = schedule?.intervals ?? [];
  const nowMs = Date.now();
  const isOffNow = intervals.some(
    (interval) => Date.parse(interval.startsAt) <= nowMs && nowMs < Date.parse(interval.endsAt),
  );

  return (
    <div className="space-y-4">
      <ol className="grid gap-3 sm:grid-cols-2">
        <StepField
          step={1}
          label={t('addressWizard.region')}
          value={currentRegion}
          hint={t('addressWizard.regionHint')}
          readOnly
        />
        <li>
          <StepField
            step={2}
            label={t('addressWizard.settlement')}
            value={settlement}
            placeholder={t('addressWizard.settlementPlaceholder')}
            onChange={(value) => {
              setSettlement(value);
              setResult(null);
              // Смена села сбрасывает улицу и дом: они принадлежат предыдущему НП,
              // и оставить их значило бы искать несуществующую улицу.
              setStreet('');
              setHouse('');
            }}
          />
        </li>
        <li>
          <StepField
            step={3}
            label={t('addressWizard.street')}
            value={street}
            placeholder={t('addressWizard.streetPlaceholder')}
            onChange={(value) => {
              setStreet(value);
              setResult(null);
              setHouse('');
            }}
          />
        </li>
        <li>
          <StepField
            step={4}
            label={t('addressWizard.house')}
            value={house}
            placeholder={t('addressWizard.housePlaceholder')}
            onChange={(value) => {
              setHouse(value);
              setResult(null);
            }}
            onEnter={submit}
          />
        </li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void submit()} disabled={!settlement.trim() || resolve.isPending} className="gap-2">
          <Search className="h-4 w-4" aria-hidden />
          {resolve.isPending ? t('addressWizard.searching') : t('addressWizard.find')}
        </Button>
        {result?.options.length ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {t('addressWizard.hintEnterHouse')}
          </span>
        ) : null}
      </div>

      {resolve.isPending && <Skeleton className="h-24 w-full rounded-2xl" />}

      {resolve.isError && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t('addressWizard.searchFailed')}
        </p>
      )}

      {result && !queue && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">{t('addressWizard.notFoundTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('addressWizard.notFoundDesc')}</p>
          {result.options.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-semibold text-foreground">{t('addressWizard.variants')}</p>
              <div className="flex flex-wrap gap-1.5">
                {result.options.map((option) => (
                  <span key={option.housePattern} className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                    {option.housePattern} → {option.queue}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {queue && (
        <section className="space-y-3 rounded-2xl border border-success/30 bg-success/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('addressWizard.yourQueue')}
              </p>
              <p className="font-display text-3xl font-bold text-foreground">{queue}</p>
              <p className={cn('mt-1 text-sm font-semibold', isOffNow ? 'text-destructive' : 'text-success')}>
                {isOffNow ? t('addressWizard.lightOff') : t('addressWizard.lightOn')}
              </p>
            </div>
            <Button onClick={save} disabled={saved} className="gap-2" variant={saved ? 'outline' : 'default'}>
              <Star className={cn('h-4 w-4', saved && 'fill-current')} aria-hidden />
              {saved ? t('addressWizard.saved') : t('addressWizard.save')}
            </Button>
          </div>

          {schedule && intervals.length > 0 ? (
            <QueueScheduleBar intervals={intervals} date={schedule.date} />
          ) : (
            <p className="text-xs text-muted-foreground">{t('addressWizard.noScheduleToday')}</p>
          )}

          {source && (
            <p className="text-[11px] text-muted-foreground/80">{t('addressWizard.source', { source })}</p>
          )}
        </section>
      )}
    </div>
  );
};

/** Одно поле шага с номером. readOnly — для области, которая берётся из выбранной в шапке. */
const StepField: React.FC<{
  step: number;
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onEnter?: () => void;
}> = ({ step, label, value, hint, placeholder, readOnly, onChange, onEnter }) => (
  <div className="space-y-1.5">
    <label htmlFor={`address-step-${step}`} className="block text-xs font-semibold text-foreground">
      {step}. {label}
    </label>
    <input
      id={`address-step-${step}`}
      type="text"
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onEnter?.();
      }}
      className={cn(
        'h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors',
        'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
        readOnly && 'bg-muted/40 text-muted-foreground',
      )}
    />
    {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);