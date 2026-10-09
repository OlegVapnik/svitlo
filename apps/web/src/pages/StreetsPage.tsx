import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Info, MapPin, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { AddressCombobox } from '../components/search/AddressCombobox.js';
import { Button } from '../components/ui/Button.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { QueueScheduleBar } from '../components/schedule/QueueScheduleBar.js';
import { useStreetQueues, useStreetSchedule } from '../api/queries.js';
import { api } from '../api/client.js';
import { formatDateTime, formatTimeRange } from '../lib/date.js';
import { cn } from '@/lib/cn';

const QUEUE_OPTIONS = ['1', '2', '3', '1/1', '1/2', '2/2'];
const STREET_KEY = 'streetsPageStreet';

function kyivDate(offsetDays = 0): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(new Date());
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const base = new Date(Date.UTC(pick('year'), pick('month') - 1, pick('day') + offsetDays));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}

export const StreetsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [street, setStreet] = useState(() => localStorage.getItem(STREET_KEY) || '');
  const [day, setDay] = useState<0 | 1>(0);
  const [token, setToken] = useState('');
  const [newStreet, setNewStreet] = useState('');
  const [newQueue, setNewQueue] = useState('2/2');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const date = useMemo(() => kyivDate(day), [day]);
  const { data: pairsData, isLoading: pairsLoading } = useStreetQueues();
  const { data: scheduleData, isLoading: scheduleLoading, isError: scheduleError, isFetching, refetch } = useStreetSchedule(street, date);

  const pairs = pairsData?.data ?? [];
  const schedule = scheduleData?.data;

  const chooseStreet = (value: string) => {
    setStreet(value);
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(STREET_KEY, trimmed);
  };

  const runAdmin = async (action: () => Promise<unknown>, okText: string) => {
    setAdminBusy(true);
    setAdminMessage(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['streetQueues'] });
      await queryClient.invalidateQueries({ queryKey: ['streetSchedule'] });
      setAdminMessage({ kind: 'ok', text: okText });
    } catch (error) {
      setAdminMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Помилка запиту' });
    } finally {
      setAdminBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-16 md:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Вулиці села</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Знайдіть вулицю та побачте графік відключень для прив'язаної черги. Дані оновлюються після ручного імпорту графіка.
        </p>
      </div>

      <Card><CardContent className="space-y-3 p-4 sm:p-5">
        <div className="space-y-1.5">
          <label htmlFor="streets-search" className="text-xs font-semibold text-foreground">Вулиця</label>
          <AddressCombobox id="streets-search" value={street} onChange={setStreet} onSelect={(suggestion) => chooseStreet(suggestion.name)} placeholder="Наприклад: вул. Зарічна" />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Оберіть дату">
          <Button variant={day === 0 ? 'default' : 'outline'} onClick={() => setDay(0)} className="gap-2"><CalendarDays className="w-4 h-4" />Сьогодні</Button>
          <Button variant={day === 1 ? 'default' : 'outline'} onClick={() => setDay(1)} className="gap-2"><CalendarDays className="w-4 h-4" />Завтра</Button>
          <span className="self-center text-sm text-muted-foreground">{date}</span>
          {street.trim().length >= 2 && (
            <Button size="sm" variant="outline" className="gap-2 sm:ml-auto" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />Оновити
            </Button>
          )}
        </div>
      </CardContent></Card>

      {street.trim().length < 2 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <MapPin className="w-6 h-6" />
          Почніть вводити назву вулиці, щоб побачити її чергу та графік.
        </div>
      ) : scheduleLoading ? (
        <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">Завантажуємо графік…</div>
      ) : scheduleError ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
          Не вдалося завантажити дані. Перевірте підключення або спробуйте пізніше.
        </div>
      ) : schedule && schedule.queue === null ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-700 dark:text-amber-300">
          <Info className="mt-0.5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Вулицю «{street}» ще не прив'язано до черги.</p>
            <p className="mt-0.5 text-xs">Додайте відповідність у розділі нижче, і графік з'явиться автоматично.</p>
          </div>
        </div>
      ) : schedule ? (
        <Card><CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{schedule.street || street}</h2>
              <p className="text-xs text-muted-foreground">{date}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">Черга {schedule.queue}</span>
          </div>
          <QueueScheduleBar intervals={schedule.intervals} date={date} />
          {schedule.intervals.length > 0 && (
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {schedule.intervals.map((interval, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: interval.stateColor }} />
                  <span className="font-mono tabular-nums">{formatTimeRange(interval.startsAt, interval.endsAt)}</span>
                  <span className="text-muted-foreground">{interval.stateName}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Джерело: {schedule.source === 'manual' ? 'ручний імпорт' : schedule.source ?? '—'}</span>
            {schedule.lastImportedAt && <span>Імпортовано: {formatDateTime(schedule.lastImportedAt)}</span>}
          </div>
        </CardContent></Card>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Усі вулиці ({pairs.length})</h2>
        {pairsLoading ? (
          <div className="text-sm text-muted-foreground">Завантаження…</div>
        ) : pairs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Поки що жодної вулиці не прив'язано до черг.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pairs.map((pair) => (
              <button
                key={pair.streetNormalized}
                type="button"
                onClick={() => chooseStreet(pair.streetName)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  street.trim() === pair.streetName ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:border-primary/50',
                )}
              >
                <span>{pair.streetName}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{pair.queue}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <details className="rounded-xl border border-border bg-card/50">
        <summary className="cursor-pointer p-4 text-sm font-semibold text-foreground">Керування відповідностями (адмін)</summary>
        <div className="space-y-3 border-t border-border p-4">
          <div className="space-y-1.5">
            <label htmlFor="admin-token" className="text-xs font-semibold text-foreground">Адмін-токен</label>
            <Input id="admin-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} className="h-11 font-mono" placeholder="ADMIN_TOKEN" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="admin-street" className="text-xs font-semibold text-foreground">Вулиця</label>
              <Input id="admin-street" value={newStreet} onChange={(event) => setNewStreet(event.target.value)} className="h-11" placeholder="вул. Зарічна" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="admin-queue" className="text-xs font-semibold text-foreground">Черга</label>
              <select id="admin-queue" value={newQueue} onChange={(event) => setNewQueue(event.target.value)} className="h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground">
                {QUEUE_OPTIONS.map((queue) => <option key={queue} value={queue}>{queue}</option>)}
              </select>
            </div>
            <Button
              className="h-11 gap-2"
              disabled={adminBusy || !token || newStreet.trim().length < 2}
              onClick={() => runAdmin(() => api.upsertStreetQueue(newStreet.trim(), newQueue, token), 'Відповідність збережено')}
            >
              <Plus className="w-4 h-4" />Додати
            </Button>
          </div>
          {adminMessage && (
            <p role="status" className={cn('text-xs', adminMessage.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>{adminMessage.text}</p>
          )}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {pairs.map((pair) => (
              <li key={pair.streetNormalized} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{pair.streetName} <span className="text-muted-foreground">· {pair.queue}</span></span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={adminBusy || !token}
                  aria-label={`Видалити ${pair.streetName}`}
                  onClick={() => runAdmin(() => api.deleteStreetQueue(pair.streetName, token), 'Відповідність видалено')}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
};
