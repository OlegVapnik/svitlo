import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { AddressCombobox } from '../components/search/AddressCombobox.js';
import type { QueueSummary, ScheduleIntervalUtc } from '@svitlo/shared';
import { Card, CardContent } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Input } from '../components/ui/Input.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { QueueScheduleBar } from '../components/schedule/QueueScheduleBar.js';
import { useMyQueues } from '../hooks/useMyQueues.js';
import { useQueues } from '../api/queries.js';
import { api } from '../api/client.js';
import { isQueueCode, normalizeQueueCode } from '../lib/queue.js';

type ScheduleResponse = { data: { queue: string; date: string; intervals: ScheduleIntervalUtc[] } };

function kyivDate(offsetDays = 0): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(new Date());
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const base = new Date(Date.UTC(pick('year'), pick('month') - 1, pick('day') + offsetDays));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}

/**
 * «Мої черги»: список черг собирает пользователь, но код очереди берётся из реальных данных —
 * подсказки приходят из GET /api/v1/queues (слоты графика + привязки улиц), а ввести код можно
 * и вручную (житель знает свою чергу из кабинета оператора). Зашитой '2/2' больше нет.
 */
export const QueueSchedulePage: React.FC = () => {
  const { t } = useTranslation();
  const { queues, addQueue, removeQueue } = useMyQueues();
  const { data: queuesData, isLoading: queuesLoading } = useQueues();
  const [street, setStreet] = useState(() => localStorage.getItem('myQueueStreet') || '');
  const [newQueue, setNewQueue] = useState('');
  const [day, setDay] = useState<0 | 1>(0);
  const date = useMemo(() => kyivDate(day), [day]);
  const [scheduleByQueue, setScheduleByQueue] = useState<Record<string, { intervals: ScheduleIntervalUtc[]; error: boolean }>>({});
  const [busyQueue, setBusyQueue] = useState('');

  const knownQueues = queuesData?.data ?? [];
  const code = normalizeQueueCode(newQueue);
  const codeValid = isQueueCode(code);
  const canAdd = street.trim().length > 0 && codeValid;

  /** Подпись варианта-подсказки: сколько улиц закреплено и на какую дату есть график. */
  function queueOptionLabel(item: QueueSummary): string {
    const parts: string[] = [];
    if (item.streets > 0) parts.push(t('queues.streetsCount', { n: item.streets }));
    if (item.lastDate) parts.push(t('queues.scheduleDate', { date: item.lastDate }));
    return parts.length > 0 ? `${item.queue} — ${parts.join(' · ')}` : `${item.queue} — ${t('queues.noSchedule')}`;
  }

  const handleAdd = () => {
    if (!canAdd) return;
    localStorage.setItem('myQueueStreet', street.trim());
    addQueue(code);
    setNewQueue('');
  };

  const loadSchedule = async (queue: string) => {
    setBusyQueue(queue);
    try {
      const result = (await api.fetchQueueSchedule(queue, date)) as ScheduleResponse;
      setScheduleByQueue((old) => ({ ...old, [queue]: { intervals: result.data.intervals, error: false } }));
    } catch {
      setScheduleByQueue((old) => ({ ...old, [queue]: { intervals: [], error: true } }));
    } finally {
      setBusyQueue('');
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-16 md:pb-6">
      <header className="space-y-0.5">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('queues.title')}</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('queues.subtitle')}</p>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="queue-street" className="text-xs font-semibold text-foreground">{t('queues.streetLabel')}</label>
              <AddressCombobox
                id="queue-street"
                value={street}
                onChange={setStreet}
                onSelect={(suggestion) => { setStreet(suggestion.name); localStorage.setItem('myQueueStreet', suggestion.name); }}
                placeholder={t('queues.streetPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="queue-code" className="text-xs font-semibold text-foreground">{t('queues.queueLabel')}</label>
              {/* Подсказки — из реального списка очередей (datalist); ввод руками остаётся возможным. */}
              <Input
                id="queue-code"
                list="queue-options"
                value={newQueue}
                onChange={(event) => setNewQueue(event.target.value)}
                placeholder={t('queues.codePlaceholder')}
                className="h-11"
                inputMode="numeric"
                autoComplete="off"
              />
              <datalist id="queue-options">
                {knownQueues.map((item) => <option key={item.queue} value={item.queue}>{queueOptionLabel(item)}</option>)}
              </datalist>
              <p className="text-xs text-muted-foreground" role="status">
                {queuesLoading
                  ? t('queues.loading')
                  : knownQueues.length > 0
                    ? t('queues.listFromData', { n: knownQueues.length })
                    : t('queues.listEmpty')}
              </p>
              {newQueue.trim().length > 0 && !codeValid && (
                <p role="alert" className="text-xs text-destructive">{t('queues.invalidCode')}</p>
              )}
            </div>
          </div>
          <Button className="gap-2" disabled={!canAdd} onClick={handleAdd}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('queues.add')}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('queues.chooseDate')}>
        <Button variant={day === 0 ? 'default' : 'outline'} onClick={() => setDay(0)} className="gap-2">
          <CalendarDays className="h-4 w-4" aria-hidden />
          {t('queues.today')}
        </Button>
        <Button variant={day === 1 ? 'default' : 'outline'} onClick={() => setDay(1)} className="gap-2">
          <CalendarDays className="h-4 w-4" aria-hidden />
          {t('queues.tomorrow')}
        </Button>
        <span className="tabular self-center text-sm text-muted-foreground">{date}</span>
      </div>

      {queues.length === 0 ? (
        <EmptyState icon={CalendarDays} title={t('queues.emptyTitle')} description={t('queues.emptyDesc')} />
      ) : (
        <div className="space-y-4">
          {queues.map((queue) => {
            const state = scheduleByQueue[queue];
            return (
              <Card key={queue}>
                <CardContent className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-foreground sm:text-base">{street || t('queues.streetFallback')}</h2>
                      <Badge variant="info">{t('queues.queueLabel')} {queue}</Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={busyQueue === queue} onClick={() => loadSchedule(queue)} className="gap-1.5">
                        <RefreshCw className={busyQueue === queue ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
                        {busyQueue === queue ? t('queues.loading') : t('queues.refresh')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => removeQueue(queue)} aria-label={`${t('queues.delete')}: ${queue}`}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <p className="tabular text-xs text-muted-foreground">{date}</p>
                  <QueueScheduleBar intervals={state?.intervals ?? []} date={date} />
                  {state?.error && <p role="alert" className="text-xs text-destructive">{t('queues.error')}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
