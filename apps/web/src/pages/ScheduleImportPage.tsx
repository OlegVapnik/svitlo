import React, { useState } from 'react';
import { Button } from '../components/ui/Button.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { Upload, CheckCircle2, AlertCircle } from 'lucide-react';

type ImportResult = { queue: string; date: string; imported: number; mergedIntervals: number };
type ApiError = { error: { code: string; message: string; details?: Array<{ path: string; message: string }> } };

export const ScheduleImportPage: React.FC = () => {
  const [queue, setQueue] = useState('2/2');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [json, setJson] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);
    setError(null);
    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      setError({ error: { code: 'JSON_PARSE', message: 'Не вдалося прочитати JSON. Перевірте, що скопійовано повну відповідь.' } });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/v1/admin/schedules/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ queue, date, payload }),
      });
      if (response.ok) {
        setResult(await response.json() as ImportResult);
      } else {
        setError(await response.json() as ApiError);
      }
    } catch {
      setError({ error: { code: 'NETWORK', message: 'Сервер недоступний. Перевірте, що API запущено.' } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-16 md:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Імпорт графіка</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Скопіюйте JSON-відповідь сайту оператора у браузері та вставте сюди. Персональні дані (ПІБ, адреса, рахунок, token) не зберігаються.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="import-queue" className="text-xs font-semibold text-foreground">Черга (наприклад 2/2 або 3)</label>
                <Input id="import-queue" value={queue} onChange={(event) => setQueue(event.target.value)} required className="h-11" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="import-date" className="text-xs font-semibold text-foreground">Дата</label>
                <Input id="import-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required className="h-11" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="import-json" className="text-xs font-semibold text-foreground">JSON-відповідь</label>
              <textarea
                id="import-json"
                value={json}
                onChange={(event) => setJson(event.target.value)}
                rows={10}
                required
                placeholder='{"status":"ok","aData":[...],"aState":{...}}'
                className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="import-token" className="text-xs font-semibold text-foreground">Адмін-токен</label>
              <Input id="import-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} required className="h-11 font-mono" />
            </div>
            <Button type="submit" disabled={busy} className="gap-2 w-full sm:w-auto">
              <Upload className="w-4 h-4" />
              <span>{busy ? 'Імпортуємо…' : 'Імпортувати графік'}</span>
            </Button>
          </form>

          {result && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Графік імпортовано</p>
                <p className="text-xs mt-0.5">
                  Черга {result.queue}, дата {result.date}: слотів у відповіді {result.imported}, після склейки {result.mergedIntervals}.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{error.error.message}</p>
                {error.error.details && (
                  <ul className="text-xs mt-1 list-disc list-inside">
                    {error.error.details.map((detail, index) => (
                      <li key={index}><code>{detail.path}</code> — {detail.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
