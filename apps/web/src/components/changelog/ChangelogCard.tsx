import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Bug, ChevronRight, Gauge, Sparkles, Zap } from 'lucide-react';
import type { ChangelogFile } from '@svitlo/shared';
import bundledChangelog from '../../data/changelog.json';
import { APP_VERSION } from '../../version.js';
import { useChangelog } from '../../api/queries.js';
import { formatDate } from '../../lib/date.js';
import { isNewerVersion } from '../../lib/app-update.js';
import { UpdateSheet } from './UpdateSheet.js';

/**
 * Встроенная копия — офлайн-фолбэк. Основной источник — сервер: задеплоенный фикс должен
 * быть виден в установленном приложении без пересборки APK.
 */
const BUNDLED = bundledChangelog as unknown as ChangelogFile;

/**
 * Компактная карточка «Що нового» на главной.
 *
 * Содержимое — только последний релиз и три счётчика. Полная история открывается в отдельной
 * шторке: на первом экране список изменений не должен спорить с графиком отключений.
 */
export const ChangelogCard: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data } = useChangelog();
  const serverFile = data?.data;
  const file = serverFile ?? BUNDLED;
  const latest = file.releases?.[0];

  const hasUpdate = useMemo(
    () => isNewerVersion(file.version || APP_VERSION, APP_VERSION),
    [file.version],
  );

  if (!latest) return null;

  const total = latest.features.length + latest.fixes.length + latest.optimizations.length;
  const preview = [...latest.features, ...latest.fixes, ...latest.optimizations].slice(0, 2);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-xs transition-colors hover:bg-card-raised"
      >
        <span className="flex w-full items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/12 text-primary">
            <Zap className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-foreground">
                {hasUpdate ? t('updates.available') : t('home.whatsNew')}
              </span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                v{file.version || APP_VERSION}
              </span>
              {hasUpdate && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/12 px-2 py-0.5 text-[10px] font-bold text-primary">
                  <ArrowUpCircle className="h-3 w-3" aria-hidden />
                  {t('updates.newBadge')}
                </span>
              )}
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {t('updates.latestRelease', { version: latest.version, date: formatDate(latest.date) })}
            </span>
          </span>
          <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>

        <span className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-[11px] font-bold text-foreground">
            <Sparkles className="h-3 w-3" aria-hidden />
            {latest.features.length}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300">
            <Bug className="h-3 w-3" aria-hidden />
            {latest.fixes.length}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
            <Gauge className="h-3 w-3" aria-hidden />
            {latest.optimizations.length}
          </span>
          <span className="ml-auto text-[11px] font-semibold text-muted-foreground">
            {t('updates.itemsCount', { count: total })}
          </span>
        </span>

        {preview.length > 0 && (
          <span className="w-full space-y-1 border-t border-hairline pt-2.5">
            {preview.map((text, index) => (
              <span key={index} className="flex gap-2 text-pretty text-xs leading-snug text-foreground/90">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                {text}
              </span>
            ))}
          </span>
        )}

        <span className="text-[11px] font-semibold text-primary">{t('updates.openHistory')}</span>
      </button>

      {open && <UpdateSheet open onClose={() => setOpen(false)} file={file} bundled={!serverFile} />}
    </>
  );
};
