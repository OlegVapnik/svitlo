import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, CheckCircle2, AlertCircle, RefreshCw, ShieldAlert, Download, MessageCircle } from 'lucide-react';
import { Button } from '../components/ui/Button.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { api, ApiError } from '../api/client.js';
import { Select } from '../components/ui/Select.js';
import { useFetchScheduleNow, useImportTelegramSchedule, useParseNow, useQueues } from '../api/queries.js';
import { useRegion } from '../hooks/useRegion.js';
import { cn } from '../lib/cn.js';

type ImportResult = { queue: string; date: string; imported: number; mergedIntervals: number };
/** Локальная форма ошибки для рендера: код, сообщение и (если есть) детали валидации. */
type ImportError = { code: string; message: string; details?: Array<{ path: string; message: string }> };

/**
 * Імпорт графіка оператора. Два шляхи:
 *  1) «Завантажити графік з оператора» — бекенд питає публічний `POST /api/info_schedule`
 *     (капчі немає, ПД немає — лише номер черги й дата). ВАЖЛИВО: це **заглушка** оператора,
 *     вона завжди повертає `aData: null`, тому реальних інтервалів ця кнопка не дає
 *     (перевірено 10.10.2026; справжній ГПВ — тільки `info_schedule_part`, він за Turnstile, і
 *     ми його не обходимо);
 *  2) ручна вставка JSON — фактичний робочий шлях наповнення `schedule_slots`.
 * Токен і вставлений JSON живуть лише в цьому компоненті й ідуть тільки на /admin/schedules/*.
 */
export const ScheduleImportPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion } = useRegion();
  const { data: queuesData, isLoading: queuesLoading } = useQueues(currentRegion);
  const knownQueues = queuesData?.data ?? [];
  // Без выдуманного дефолта: очередь выбирается только из реального списка (GET /api/v1/queues).
  const [queue, setQueue] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [json, setJson] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<ImportError | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseMsg, setParseMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [fetchMsg, setFetchMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [telegramMsg, setTelegramMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const parseNow = useParseNow();
  const fetchNow = useFetchScheduleNow();
  const importTelegram = useImportTelegramSchedule();

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

  /**
   * Немедленный запуск парсинга реальных источников оператора (POST /admin/parse).
   * Требует админ-токен: публично дёргать запросы к оператору нельзя.
   */
  const askOperator = async () => {
    setParseMsg(null);
    try {
      const result = (await parseNow.mutateAsync(token)) as {
        data?: Array<{ recordsFound?: number; error?: string }>;
      };
      const rows = result.data ?? [];
      const records = rows.reduce((sum, row) => sum + (row.recordsFound ?? 0), 0);
      const failed = rows.filter((row) => row.error).length;
      setParseMsg({
        kind: failed > 0 ? 'err' : 'ok',
        text: t('scheduleImport.parseSuccess', { sources: rows.length, records, failed }),
      });
    } catch (error) {
      setParseMsg({
        kind: 'err',
        text: t('scheduleImport.parseError', {
          message: error instanceof ApiError ? error.message : t('scheduleImport.network'),
        }),
      });
    }
  };

  /**
   * Запит публічного методу оператора (POST /admin/schedules/fetch): потрібні черга, дата й адмін-токен.
   * Порожній результат (intervals = 0) — очікуваний: публічний `info_schedule` завжди порожній
   * (`aData: null`), а метод з даними (`info_schedule_part`) закритий Turnstile і ми його не обходимо.
   */
  const fetchFromOperator = async () => {
    setFetchMsg(null);
    try {
      const result = (await fetchNow.mutateAsync({ queue, date, token })) as {
        data?: { mergedIntervals?: number; intervals?: number };
      };
      const intervals = result.data?.intervals ?? 0;
      setFetchMsg({
        kind: 'ok',
        text:
          intervals > 0
            ? t('scheduleImport.fetchSuccess', { queue, date, intervals, merged: result.data?.mergedIntervals ?? 0 })
            : t('scheduleImport.fetchEmpty', { queue, date }),
      });
    } catch (error) {
      setFetchMsg({
        kind: 'err',
        text: t('scheduleImport.fetchError', {
          message: error instanceof ApiError ? error.message : t('scheduleImport.network'),
        }),
      });
    }
  };

  /**
   * Імпорт ГПВ з публічного Telegram-каналу оператора (POST /admin/schedules/import-telegram).
   * Назовні мережа не потрібна: бекенд бере вже збережені пости каналу. Капчі й ПД там немає.
   * Це той шлях, який реально дає черги+час (HANDOFF §18.9).
   */
  const importFromTelegram = async () => {
    setTelegramMsg(null);
    try {
      const result = (await importTelegram.mutateAsync(token)) as {
        data?: { imported?: number; posts?: number; matchedPosts?: number; queues?: string[] };
      };
      const imported = result.data?.imported ?? 0;
      const queues = (result.data?.queues ?? []).join(', ');
      setTelegramMsg({
        kind: 'ok',
        text:
          imported > 0
            ? t('scheduleImport.telegramSuccess', { imported, queues, posts: result.data?.posts ?? 0 })
            : t('scheduleImport.telegramEmpty'),
      });
    } catch (error) {
      setTelegramMsg({
        kind: 'err',
        text: t('scheduleImport.telegramError', {
          message: error instanceof ApiError ? error.message : t('scheduleImport.network'),
        }),
      });
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
                {/* Выпадающий список реальных черг — вместо ручного ввода (раньше был зашитый '2/2'). */}
                <Select
                  id="import-queue"
                  value={queue}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setQueue(event.target.value)}
                  required
                  disabled={knownQueues.length === 0}
                  className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {queuesLoading ? t('queues.loading') : t('scheduleImport.queuePlaceholder')}
                  </option>
                  {knownQueues.map((item) => (
                    <option key={item.queue} value={item.queue}>
                      {item.queue}{item.lastDate ? ` — ${item.lastDate}` : ''}
                    </option>
                  ))}
                </Select>
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
                className="tabular w-full rounded-xl border border-input bg-background p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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

          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={fetchFromOperator}
                disabled={!queue || !date || !token || fetchNow.isPending}
                className="gap-2"
              >
                <Download className={cn('h-4 w-4', fetchNow.isPending && 'animate-spin')} aria-hidden />
                {fetchNow.isPending ? t('scheduleImport.fetchRunning') : t('scheduleImport.fetchNow')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('scheduleImport.fetchHint')}</span>
            </div>
            {fetchMsg && (
              <p role="status" className={cn('text-xs', fetchMsg.kind === 'ok' ? 'text-success' : 'text-destructive')}>
                {fetchMsg.text}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={importFromTelegram}
                disabled={!token || importTelegram.isPending}
                className="gap-2"
              >
                <MessageCircle className={cn('h-4 w-4', importTelegram.isPending && 'animate-spin')} aria-hidden />
                {importTelegram.isPending ? t('scheduleImport.telegramRunning') : t('scheduleImport.telegramNow')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('scheduleImport.telegramHint')}</span>
            </div>
            {telegramMsg && (
              <p role="status" className={cn('text-xs', telegramMsg.kind === 'ok' ? 'text-success' : 'text-destructive')}>
                {telegramMsg.text}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={askOperator}
                disabled={!token || parseNow.isPending}
                className="gap-2"
              >
                <RefreshCw className={cn('h-4 w-4', parseNow.isPending && 'animate-spin')} aria-hidden />
                {parseNow.isPending ? t('scheduleImport.parseRunning') : t('scheduleImport.parseNow')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('scheduleImport.parseHint')}</span>
            </div>
            {parseMsg && (
              <p role="status" className={cn('text-xs', parseMsg.kind === 'ok' ? 'text-success' : 'text-destructive')}>
                {parseMsg.text}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
