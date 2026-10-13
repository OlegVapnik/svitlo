import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Info, MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { AddressCombobox } from '../components/search/AddressCombobox.js';
import { Button } from '../components/ui/Button.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { Badge } from '../components/ui/Badge.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ErrorState } from '../components/common/ErrorState.js';
import { QueueScheduleBar } from '../components/schedule/QueueScheduleBar.js';
import { useRegion } from '../hooks/useRegion.js';
import { useBookmarks } from '../hooks/useBookmarks.js';
import { useQueues, useStreetQueues, useStreetSchedule } from '../api/queries.js';
import { api } from '../api/client.js';
import { formatDateTime, formatTimeRange } from '../lib/date.js';
import { cn } from '@/lib/cn';

const STREET_KEY = 'streetsPageStreet';

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
 * «Вулиці села»: пошук вулиці → її черга → графік на добу. Внизу — адмін-блок
 * керування відповідностями (потребує ADMIN_TOKEN, який ніде не зберігається).
 */
export const StreetsPage: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { currentRegion } = useRegion();
  const { addBookmark } = useBookmarks();
  const { data: queuesData } = useQueues(currentRegion);
  const queueOptions = useMemo(() => {
    const list = (queuesData?.data ?? []).map((q) => q.queue);
    return list.length > 0 ? list : ['1/1', '1/2', '2/1', '2/2', '3/1', '3/2'];
  }, [queuesData]);
  const [street, setStreet] = useState(() => localStorage.getItem(STREET_KEY) || '');
  const [day, setDay] = useState<0 | 1>(0);
  const [token, setToken] = useState('');
  const [newStreet, setNewStreet] = useState('');
  const [newQueue, setNewQueue] = useState('1/1');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  const date = useMemo(() => kyivDate(day), [day]);
  const { data: pairsData, isLoading: pairsLoading } = useStreetQueues();
  const {
    data: scheduleData,
    isLoading: scheduleLoading,
    isError: scheduleError,
    isFetching,
    refetch,
  } = useStreetSchedule(street, date);

  const pairs = pairsData?.data ?? [];
  // useStreetSchedule отдаёт конверт { data }, как и остальные хуки api/queries.ts.
  const schedule = scheduleData?.data;

  const chooseStreet = (value: string) => {
    setStreet(value);
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(STREET_KEY, trimmed);
  };

  const runAdmin = async (action: () => Promise<unknown>, okKey: string) => {
    setAdminBusy(true);
    setAdminMessage(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['streetQueues'] });
      await queryClient.invalidateQueries({ queryKey: ['streetSchedule'] });
      setAdminMessage({ kind: 'ok', text: t(okKey) });
    } catch (error) {
      setAdminMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : t('streets.requestError'),
      });
    } finally {
      setAdminBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-16 md:pb-6">
      <header className="space-y-0.5">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {t('streets.title')}
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('streets.subtitle')}</p>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="space-y-1.5">
            <label htmlFor="streets-search" className="text-xs font-semibold text-foreground">
              {t('streets.streetLabel')}
            </label>
            <AddressCombobox
              id="streets-search"
              value={street}
              onChange={setStreet}
              onSelect={(suggestion) => chooseStreet(suggestion.name)}
              placeholder={t('streets.searchPlaceholder')}
            />
          </div>
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={t('streets.selectDate')}
          >
            <Button
              variant={day === 0 ? 'default' : 'outline'}
              onClick={() => setDay(0)}
              className="gap-2"
            >
              <CalendarDays className="h-4 w-4" aria-hidden />
              {t('streets.today')}
            </Button>
            <Button
              variant={day === 1 ? 'default' : 'outline'}
              onClick={() => setDay(1)}
              className="gap-2"
            >
              <CalendarDays className="h-4 w-4" aria-hidden />
              {t('streets.tomorrow')}
            </Button>
            <span className="tabular self-center text-sm text-muted-foreground">{date}</span>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3" aria-busy={isFetching}>
        {street.trim().length < 2 ? (
          <EmptyState
            icon={MapPin}
            title={t('streets.hintTitle')}
            description={t('streets.hint')}
          />
        ) : scheduleLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
        ) : scheduleError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : schedule && schedule.queue === null ? (
          <div className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/5 p-4">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t('streets.notBound')}: «{street}»
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('streets.notBoundDesc')}</p>
            </div>
          </div>
        ) : schedule ? (
          <Card>
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-foreground sm:text-base">
                    {schedule.street || street}
                  </h2>
                  <p className="tabular text-xs text-muted-foreground">{date}</p>
                </div>
                <Badge variant="info">
                  {t('streets.queue')} {schedule.queue}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    addBookmark({
                      label: schedule.street || street,
                      regionCpu: currentRegion,
                      settlementName: undefined,
                      streetName: schedule.street || street,
                      queue: schedule.queue ?? '',
                    });
                  }}
                  aria-label={`${t('common.save')} ${schedule.street || street}`}
                >
                  <Star className="h-3.5 w-3.5" aria-hidden />
                  {t('streets.addToBookmarks')}
                </Button>
              </div>
              <QueueScheduleBar intervals={schedule.intervals} date={date} />
              {schedule.intervals.length > 0 && (
                <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
                  {schedule.intervals.map((interval, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: interval.stateColor }}
                        aria-hidden
                      />
                      <span className="tabular font-mono">
                        {formatTimeRange(interval.startsAt, interval.endsAt)}
                      </span>
                      <span className="text-muted-foreground">{interval.stateName}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {t('streets.source')}:{' '}
                  {schedule.source === 'manual'
                    ? t('streets.sourceManual')
                    : (schedule.source ?? '—')}
                </span>
                {schedule.lastImportedAt && (
                  <span>
                    {t('streets.imported')}: {formatDateTime(schedule.lastImportedAt)}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground sm:text-base">
          {t('streets.allStreets')} ({pairs.length})
        </h2>
        {pairsLoading ? (
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="h-11 w-28 rounded-full" />
            ))}
          </div>
        ) : pairs.length === 0 ? (
          <EmptyState title={t('streets.pairsEmpty')} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {pairs.map((pair) => (
              <button
                key={pair.streetNormalized}
                type="button"
                onClick={() => chooseStreet(pair.streetName)}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  street.trim() === pair.streetName
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card hover:border-primary/50',
                )}
              >
                <span>{pair.streetName}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {pair.queue}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <details className="rounded-2xl border border-border bg-card/50">
        <summary className="cursor-pointer p-4 text-sm font-semibold text-foreground">
          {t('streets.manage')}
        </summary>
        <div className="space-y-3 border-t border-border p-4">
          <div className="space-y-1.5">
            <label htmlFor="admin-token" className="text-xs font-semibold text-foreground">
              {t('streets.adminToken')}
            </label>
            <Input
              id="admin-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="h-11 font-mono"
              placeholder="ADMIN_TOKEN"
              autoComplete="off"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="admin-street" className="text-xs font-semibold text-foreground">
                {t('streets.adminStreet')}
              </label>
              <Input
                id="admin-street"
                value={newStreet}
                onChange={(event) => setNewStreet(event.target.value)}
                className="h-11"
                placeholder="вул. Зарічна"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="admin-queue" className="text-xs font-semibold text-foreground">
                {t('streets.adminQueue')}
              </label>
              <select
                id="admin-queue"
                value={newQueue}
                onChange={(event) => setNewQueue(event.target.value)}
                className="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
              >
                {queueOptions.map((queue) => (
                  <option key={queue} value={queue}>
                    {queue}
                  </option>
                ))}
              </select>
            </div>
            <Button
              className="gap-2"
              disabled={adminBusy || !token || newStreet.trim().length < 2}
              onClick={() =>
                runAdmin(
                  () => api.upsertStreetQueue(newStreet.trim(), newQueue, token),
                  'streets.savedOk',
                )
              }
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('streets.adminAdd')}
            </Button>
          </div>
          {adminMessage && (
            <p
              role="status"
              className={cn(
                'text-xs font-medium',
                adminMessage.kind === 'ok' ? 'text-success' : 'text-destructive',
              )}
            >
              {adminMessage.text}
            </p>
          )}
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {pairs.map((pair) => (
              <li
                key={pair.streetNormalized}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {pair.streetName} <span className="text-muted-foreground">· {pair.queue}</span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={adminBusy || !token}
                  aria-label={`${t('common.delete')} ${pair.streetName}`}
                  onClick={() =>
                    runAdmin(
                      () => api.deleteStreetQueue(pair.streetName, token),
                      'streets.deletedOk',
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
};
