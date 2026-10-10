import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import { Button } from '../components/ui/Button.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { api, ApiError } from '../api/client.js';

type ImportResult = { queue: string; date: string; imported: number; mergedIntervals: number };
/** Локальная форма ошибки для рендера: код, сообщение и (если есть) детали валидации. */
type ImportError = { code: string; message: string; details?: Array<{ path: string; message: string }> };

/**
 * Ручной импорт графика оператора: сайт оператора отдаёт JSON только в авторизованной браузерной
 * сессии, поэтому копипаст — единственный легальный путь (WAF/бан не обходим). Токен и вставленный
 * JSON живут только в этом компоненте и уходят лишь на /admin/schedules/import.
 */
export const ScheduleImportPage: React.FC = () => {
  const { t } = useTranslation();
  const [queue, setQueue] = useState('2/2');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [json, setJson] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<ImportError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);
    setError(null);
    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      setError({ code: 'JSON_PARSE', message: t('scheduleImport.badJson') });
      return;
    }
    setBusy(true);
    try {
      // Единственный путь в сеть — api/client.ts (golden rule #9). Конверт ошибки
      // `{ error: { code, message, details } }` разбирает ApiError, отдельный fetch не нужен.
      setResult((await api.importSchedule(queue, date, payload, token)) as ImportResult);
    } catch (error) {
      if (error instanceof ApiError) {
        setError({ code: error.code, message: error.message, details: error.details });
      } else {
        setError({ code: 'NETWORK', message: t('scheduleImport.network') });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-16 md:pb-6">
      <header className="space-y-0.5">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('scheduleImport.title')}</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('scheduleImport.subtitle')}</p>
      </header>

      <div className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/5 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-foreground">{t('scheduleImport.warningTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('scheduleImport.warningText')}</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="import-queue" className="text-xs font-semibold text-foreground">{t('scheduleImport.queueLabel')}</label>
                <Input id="import-queue" value={queue} onChange={(event) => setQueue(event.target.value)} required className="h-11" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="import-date" className="text-xs font-semibold text-foreground">{t('scheduleImport.dateLabel')}</label>
                <Input id="import-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required className="h-11" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="import-json" className="text-xs font-semibold text-foreground">{t('scheduleImport.jsonLabel')}</label>
              <textarea
                id="import-json"
                value={json}
                onChange={(event) => setJson(event.target.value)}
                rows={10}
                required
                spellCheck={false}
                placeholder='{"status":"ok","aData":[...],"aState":{...}}'
                className="tabular w-full rounded-xl border border-input bg-background p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="import-token" className="text-xs font-semibold text-foreground">{t('scheduleImport.tokenLabel')}</label>
              <Input id="import-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} required autoComplete="off" className="h-11 font-mono" />
            </div>

            <Button type="submit" disabled={busy} className="w-full gap-2 sm:w-auto">
              <Upload className="h-4 w-4" aria-hidden />
              {busy ? t('scheduleImport.submitting') : t('scheduleImport.submit')}
            </Button>
          </form>

          {result && (
            <div role="status" className="mt-4 flex items-start gap-2 rounded-2xl border border-success/40 bg-success/5 p-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-foreground">{t('scheduleImport.successTitle')}</p>
                <p className="tabular mt-0.5 text-xs text-muted-foreground">
                  {t('scheduleImport.successText', { queue: result.queue, date: result.date, slots: result.imported, merged: result.mergedIntervals })}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-foreground">{error.message}</p>
                {error.details && (
                  <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                    {error.details.map((detail, index) => (
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
