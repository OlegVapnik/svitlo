import React, { useMemo, useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { AddressCombobox } from '../components/search/AddressCombobox.js';
import type { ScheduleIntervalUtc } from '@energy-monitor/shared';
import { Card, CardContent } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { QueueScheduleBar } from '../components/schedule/QueueScheduleBar.js';
import { useMyQueues } from '../hooks/useMyQueues.js';
import { api } from '../api/client.js';

const QUEUE_OPTIONS = ['2/2'];
type ScheduleResponse = { data: { queue: string; date: string; intervals: ScheduleIntervalUtc[]; demo?: boolean } };

function kyivDate(offsetDays = 0): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });
  const now = new Date();
  const parts = formatter.formatToParts(now);
  const y = Number(parts.find((part) => part.type === 'year')?.value);
  const m = Number(parts.find((part) => part.type === 'month')?.value);
  const d = Number(parts.find((part) => part.type === 'day')?.value);
  const result = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`;
}

export const QueueSchedulePage: React.FC = () => {
  const { queues, addQueue, removeQueue } = useMyQueues();
  const [street, setStreet] = useState(() => localStorage.getItem('myQueueStreet') || '');
  const [newQueue, setNewQueue] = useState(QUEUE_OPTIONS[0]!);
  const [day, setDay] = useState<0 | 1>(0);
  const date = useMemo(() => kyivDate(day), [day]);
  const [scheduleByQueue, setScheduleByQueue] = useState<Record<string, { intervals: ScheduleIntervalUtc[]; error: boolean; demo?: boolean }>>({});
  const [busyQueue, setBusyQueue] = useState('');

  const loadSchedule = async (queue: string) => {
    setBusyQueue(queue);
    try {
      const result = await api.fetchQueueSchedule(queue, date) as ScheduleResponse;
      setScheduleByQueue((old) => ({ ...old, [queue]: { intervals: result.data.intervals, error: false, demo: result.data.demo } }));
    } catch {
      setScheduleByQueue((old) => ({ ...old, [queue]: { intervals: [], error: true } }));
    } finally {
      setBusyQueue('');
    }
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-16 md:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Мої черги</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Перелік зберігається лише у localStorage цього браузера.</p>
      </div>
      <Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor="queue-street" className="text-xs font-semibold text-foreground">Вулиця в селі Деснянське</label>
          <AddressCombobox id="queue-street" value={street} onChange={setStreet} onSelect={(suggestion) => { const selected = suggestion.name; setStreet(selected); localStorage.setItem('myQueueStreet', selected); }} placeholder="Знайти вулицю…" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="queue-select" className="text-xs font-semibold text-foreground">Черга</label>
          <select id="queue-select" value={newQueue} onChange={(event) => setNewQueue(event.target.value)} className="h-11 w-full rounded-lg border-border bg-background px-3 text-sm text-foreground">
            {QUEUE_OPTIONS.map((queue) => <option key={queue} value={queue}>{queue}</option>)}
          </select>
        </div>
        <Button disabled={!street.trim()} onClick={() => { if (street.trim()) { localStorage.setItem('myQueueStreet', street.trim()); addQueue(newQueue); } }} className="h-11 gap-2"><Plus className="w-4 h-4" />Додати</Button>
      </CardContent></Card>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Оберіть дату">
        <Button variant={day === 0 ? 'default' : 'outline'} onClick={() => setDay(0)} className="gap-2"><CalendarDays className="w-4 h-4" />Сьогодні</Button>
        <Button variant={day === 1 ? 'default' : 'outline'} onClick={() => setDay(1)} className="gap-2"><CalendarDays className="w-4 h-4" />Завтра</Button>
        <span className="self-center text-sm text-muted-foreground">{date}</span>
      </div>
      {queues.length === 0 ? <div className="rounded-xl border-dashed border-border p-8 text-center text-sm text-muted-foreground">Додайте свою чергу, щоб бачити графік.</div> : (
        <div className="space-y-4">{queues.map((queue) => {
          const state = scheduleByQueue[queue];
          return <Card key={queue}><CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><h2 className="font-semibold text-foreground">{street || 'Моя вулиця'} · {queue}</h2><p className="text-xs text-muted-foreground">{date}</p></div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busyQueue === queue} onClick={() => loadSchedule(queue)}>{busyQueue === queue ? 'Завантажуємо…' : 'Оновити'}</Button>
                <Button size="sm" variant="outline" onClick={() => removeQueue(queue)} aria-label={`Видалити чергу ${queue}`}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
            {state?.demo && <p className="text-xs font-medium text-amber-600">ДЕМО-графік, синтетичні дані — не використовуйте для планування.</p>}
            <QueueScheduleBar intervals={state?.intervals ?? []} date={date} />
            {state?.error && <p role="alert" className="text-xs text-destructive">Не вдалося завантажити графік. Перевірте підключення або імпортуйте його вручну.</p>}
          </CardContent></Card>;
        })}</div>
      )}
    </div>
  );
};

