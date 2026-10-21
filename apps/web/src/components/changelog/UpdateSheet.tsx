import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Bug, Check, ChevronDown, Gauge, Sparkles, Zap } from 'lucide-react';
import type { ChangelogFile, ChangelogRelease } from '@svitlo/shared';
import { Sheet } from '../ui/Sheet.js';
import { APP_VERSION } from '../../version.js';
import { formatDate } from '../../lib/date.js';
import { cn } from '../../lib/cn.js';
import { markVersionSeen, readLastSeenVersion, summarizeUpdate } from '../../lib/app-update.js';

interface Props {
  open: boolean;
  onClose: () => void;
  file: ChangelogFile;
  /** Данные пришли из встроенной копии: подпись источника честно говорит об этом. */
  bundled: boolean;
}

type SectionKey = 'features' | 'fixes' | 'optimizations';

const SECTION_META: Array<{ key: SectionKey; Icon: typeof Sparkles; labelKey: string; tone: string }> = [
  { key: 'features', Icon: Sparkles, labelKey: 'updates.features', tone: 'text-foreground' },
  { key: 'fixes', Icon: Bug, labelKey: 'updates.fixes', tone: 'text-amber-300' },
  { key: 'optimizations', Icon: Gauge, labelKey: 'updates.optimizations', tone: 'text-emerald-300' },
];

function kyivToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
}

const ReleaseSection: React.FC<{
  sectionKey: SectionKey;
  Icon: typeof Sparkles;
  label: string;
  tone: string;
  items: string[];
}> = ({ sectionKey, Icon, label, tone, items }) => {
  if (items.length === 0) return null;
  return (
    <section className="mt-3 rounded-2xl border border-white/6 bg-background/40" aria-label={label}>
      <div className="flex items-center justify-between gap-3 px-3 pt-3">
        <h4 className="inline-flex items-center gap-2 text-xs font-bold text-foreground">
          <Icon className={cn('h-4 w-4', tone)} aria-hidden />
          {label}
        </h4>
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-white/8 px-2 text-[11px] font-bold text-foreground">
          {items.length}
        </span>
      </div>
      <ul className="mt-1 px-3 pb-1">
        {items.map((text, index) => (
          <li
            key={`${sectionKey}-${index}`}
            className="border-b border-white/6 py-2.5 text-pretty text-sm leading-snug text-foreground last:border-0"
          >
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
};

const ReleaseCard = memo(function ReleaseCard({
  release,
  isOpen,
  today,
  onToggle,
}: {
  release: ChangelogRelease;
  isOpen: boolean;
  today: string;
  onToggle: (version: string) => void;
}) {
  const { t } = useTranslation();
  const total = release.features.length + release.fixes.length + release.optimizations.length;
  const dateLabel = release.date === today ? t('updates.today') : formatDate(release.date);

  return (
    <article className="relative">
      <span
        className={cn(
          'absolute -left-8 top-4 flex h-5 w-5 items-center justify-center rounded-full border',
          isOpen ? 'border-primary/60 bg-primary/20 text-primary' : 'border-white/15 bg-card text-muted-foreground',
        )}
        aria-hidden
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-card">
        <button
          type="button"
          onClick={() => onToggle(release.version)}
          aria-expanded={isOpen}
          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/4"
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-display text-base font-bold text-foreground">v{release.version}</span>
              <span
                className={cn(
                  'rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                  release.tag === 'Release'
                    ? 'border-primary/30 bg-primary/15 text-primary'
                    : 'border-white/15 bg-white/8 text-muted-foreground',
                )}
              >
                {release.tag}
              </span>
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {dateLabel} · {t('updates.featuresCount', { count: release.features.length })} ·{' '}
              {t('updates.fixesCount', { count: release.fixes.length })}
            </span>
          </span>
          <ChevronDown
            className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
            aria-hidden
          />
        </button>
        {isOpen && (
          <div className="release-reveal border-t border-white/6 px-3 pb-3">
            <div className="min-h-0 overflow-hidden">
              {SECTION_META.map(({ key, Icon, labelKey, tone }) => (
                <ReleaseSection
                  key={key}
                  sectionKey={key}
                  Icon={Icon}
                  label={t(labelKey)}
                  tone={tone}
                  items={release[key]}
                />
              ))}
              {total === 0 && <p className="px-1 py-4 text-xs text-muted-foreground">{t('updates.emptyRelease')}</p>}
            </div>
          </div>
        )}
      </div>
    </article>
  );
});

/**
 * Шторка истории обновлений.
 *
 * Здесь намеренно НЕТ кнопки «Завантажити APK»: экран отвечает на вопрос «что изменилось»,
 * а установка живёт в отдельном OTA-окне и появляется только при реально новой версии.
 *
 * Производительность: каждая карточка — `memo`, содержимое свёрнутого релиза вообще не
 * рендерится, поэтому 11 релизов не создают сотни невидимых строк. Раскрытие анимируется
 * CSS (`release-reveal`), без чтения высоты в JS и без layout thrash.
 */
export const UpdateSheet: React.FC<Props> = ({ open, onClose, file, bundled }) => {
  const { t } = useTranslation();
  const [lastSeen, setLastSeen] = useState<string | null>(readLastSeenVersion);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([file.releases[0]?.version ?? '']));
  const today = useMemo(kyivToday, []);

  useEffect(() => {
    if (!open) return;
    setLastSeen(readLastSeenVersion());
    setExpanded(new Set([file.releases[0]?.version ?? '']));
  }, [open, file.releases]);

  const summary = useMemo(
    () => summarizeUpdate(file.releases, APP_VERSION, file.version || APP_VERSION, lastSeen),
    [file.releases, file.version, lastSeen],
  );

  const close = () => {
    markVersionSeen(summary.toVersion);
    setLastSeen(summary.toVersion);
    onClose();
  };

  const toggleRelease = useCallback((version: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }, []);

  const header = (
    <div className="flex items-center gap-3 pr-10">
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary shadow-xs">
        <Zap className="h-6 w-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="truncate font-display text-xl font-bold tracking-tight text-foreground">
          {t('updates.history')}
        </h2>
        <p className="truncate text-xs font-medium text-muted-foreground">Svitlo · v{summary.toVersion}</p>
      </div>
    </div>
  );

  return (
    <Sheet open={open} onClose={close} title={t('updates.history')} header={header}>
      <section className="rounded-3xl border border-white/8 bg-surface-container-high p-4">
        <div className="flex items-center justify-center gap-2 text-xs font-bold">
          <span className="rounded-lg border border-white/8 bg-white/5 px-2.5 py-1 text-muted-foreground">
            v{summary.fromVersion}
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="rounded-lg border border-white/20 bg-white/12 px-2.5 py-1 text-foreground shadow-xs">
            v{summary.toVersion}
          </span>
        </div>

        <p className="mt-4 text-center font-display text-2xl font-bold tracking-tight text-foreground">
          {t('updates.releasesCount', { count: summary.releases.length })}
        </p>
        <p className="mt-1 text-center text-xs text-muted-foreground">{t('updates.summaryHint')}</p>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 text-xs font-bold text-foreground">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {t('updates.featuresCount', { count: summary.features })}
          </span>
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 text-xs font-bold text-amber-300">
            <Bug className="h-3.5 w-3.5" aria-hidden />
            {t('updates.fixesCount', { count: summary.fixes })}
          </span>
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-300">
            <Gauge className="h-3.5 w-3.5" aria-hidden />
            {t('updates.optimizationsCount', { count: summary.optimizations })}
          </span>
        </div>

        <p className="mt-3 inline-flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {bundled ? t('changelog.sourceBundled') : t('updates.serverSource')}
        </p>
      </section>

      <div className="relative mt-5 space-y-3 pl-8">
        <span className="absolute bottom-4 left-3 top-3 w-px bg-white/10" aria-hidden />
        {file.releases.map((release) => (
          <ReleaseCard
            key={release.version}
            release={release}
            isOpen={expanded.has(release.version)}
            today={today}
            onToggle={toggleRelease}
          />
        ))}
      </div>
    </Sheet>
  );
};

