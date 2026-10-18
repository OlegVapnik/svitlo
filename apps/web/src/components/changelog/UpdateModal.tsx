import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Bug, Clock, Download, Gauge, ShieldCheck, Sparkles } from 'lucide-react';
import { useChangelog } from '../../api/queries.js';
import { APP_VERSION } from '../../version.js';
import type { AppVersionInfo, ChangelogFile } from '@svitlo/shared';
import { Button } from '../ui/Button.js';
import { Sheet } from '../ui/Sheet.js';
import { cn } from '../../lib/cn.js';
import {
  dismissVersion,
  downloadAndroidUpdate,
  isNativeApp,
  isNewerVersion,
  readDismissedVersion,
  reloadWebApp,
  summarizeUpdate,
} from '../../lib/app-update.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

interface Props {
  open: boolean;
  info: AppVersionInfo;
  onClose: () => void;
}

/**
 * Окно OTA-обновления: показывается только когда сервер опубликовал версию новее установленной.
 * В Android «Оновити» отдаёт URL и SHA-256 нативной обёртке; в браузере — сбрасывает SW-кэш и
 * перезагружает страницу. Никаких «загрузок APK» в истории чейнджлога здесь нет.
 */
export const UpdateModal: React.FC<Props> = ({ open, info, onClose }) => {
  const { t } = useTranslation();
  const changelog = useChangelog();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const native = isNativeApp();
  const file = changelog.data?.data as ChangelogFile | undefined;

  const summary = useMemo(
    () => summarizeUpdate(file?.releases ?? [], APP_VERSION, info.version, APP_VERSION),
    [file?.releases, info.version],
  );
  const notes = useMemo(() => {
    const fromReleases = summary.releases.flatMap((release) => [
      ...release.features,
      ...release.fixes,
      ...release.optimizations,
    ]);
    return (fromReleases.length > 0 ? fromReleases : info.notes).slice(0, 6);
  }, [info.notes, summary.releases]);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setStatus(null);
  }, [open, info.version]);

  const later = () => {
    dismissVersion(info.version);
    onClose();
  };

  const update = async () => {
    setStatus(null);
    if (native) {
      if (!SHA256_PATTERN.test(info.sha256)) {
        setStatus(t('updateModal.hashMissing'));
        return;
      }
      setBusy(true);
      const started = downloadAndroidUpdate(info.apkUrl, info.sha256);
      setBusy(false);
      setStatus(started ? t('updateModal.downloadStarted') : t('updateModal.downloadFailed'));
      return;
    }
    setBusy(true);
    setStatus(t('updateModal.reloading'));
    await reloadWebApp();
  };

  const footer = (
    <div className="mt-4 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
      <Button onClick={() => void update()} disabled={busy} className="gap-2">
        <Download className="h-4 w-4" aria-hidden />
        {busy ? t('updateModal.updating') : t('updateModal.updateNow')}
      </Button>
      <Button variant="outline" onClick={later} className="gap-2">
        <Clock className="h-4 w-4" aria-hidden />
        {t('updateModal.later')}
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onClose={later} title={t('updateModal.title')} footer={footer}>
      <div className="space-y-4">
        <div className="rounded-3xl border border-primary/25 bg-primary/8 p-4">
          <div className="flex items-center justify-center gap-2 text-sm font-bold">
            <span className="rounded-lg border border-border bg-muted px-2.5 py-1 text-muted-foreground">
              v{APP_VERSION}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="rounded-lg border border-primary/30 bg-primary/12 px-2.5 py-1 text-primary">
              v{info.version}
            </span>
          </div>
          <p className="mt-3 text-center font-display text-xl font-bold text-foreground">
            {t('updateModal.title')}
          </p>
          <p className="mt-1 text-center text-xs text-muted-foreground">{t('updateModal.subtitle')}</p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Counter Icon={Sparkles} value={summary.features} label={t('updates.features')} />
            <Counter Icon={Bug} value={summary.fixes} label={t('updates.fixes')} />
            <Counter Icon={Gauge} value={summary.optimizations} label={t('updates.optimizations')} />
          </div>
        </div>

        {notes.length > 0 && (
          <section aria-label={t('updateModal.whatsNew')}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t('updateModal.whatsNew')}
            </h3>
            <ul className="mt-2 space-y-1.5">
              {notes.map((note, index) => (
                <li key={`${note}-${index}`} className="flex gap-2 text-sm leading-snug text-foreground">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="text-pretty">{note}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
          {t('updateModal.hashHint')}
        </p>

        {status && (
          <p role="status" className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
            {status}
          </p>
        )}
      </div>
    </Sheet>
  );
};

const Counter: React.FC<{ Icon: typeof Sparkles; value: number; label: string }> = ({ Icon, value, label }) => (
  <div className="rounded-2xl border border-border bg-card px-2 py-3 text-center">
    <Icon className={cn('mx-auto h-4 w-4 text-muted-foreground')} aria-hidden />
    <p className="mt-1 text-lg font-bold tabular text-foreground">{value}</p>
    <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
  </div>
);

/**
 * Гейт OTA: сам решает, показывать ли окно. Нет сети или сервер не ответил — данных нет,
 * значит и окна нет; ошибку пользователю не показываем.
 */
export const UpdateGate: React.FC<{ info: AppVersionInfo | null }> = ({ info }) => {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(readDismissedVersion);
  const native = isNativeApp();

  useEffect(() => {
    if (!native || !info) {
      setOpen(false);
      return;
    }
    const shouldShow = isNewerVersion(info.version, APP_VERSION) && dismissed !== info.version;
    setOpen(shouldShow);
  }, [dismissed, info, native]);

  if (!native || !info || !isNewerVersion(info.version, APP_VERSION) || !open) return null;

  return (
    <UpdateModal
      open
      info={info}
      onClose={() => {
        setOpen(false);
        setDismissed(readDismissedVersion());
      }}
    />
  );
};

