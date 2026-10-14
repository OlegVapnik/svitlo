import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Wrench, ChevronDown } from 'lucide-react';
import bundledChangelog from '../../data/changelog.json';
import { useChangelog } from '../../api/queries.js';
import { cn } from '../../lib/cn.js';

type ChangelogEntry = {
  hash: string;
  date: string;
  kind: 'new' | 'fix';
  label: string;
  text: string;
};

/**
 * Встроенная копия чейджлога — только офлайн-фолбэк.
 *
 * Основной источник — сервер: задеплоенный фикс должен быть виден в уже установленном
 * приложении без пересборки APK. Если сети нет и кеша тоже, показываем то, что лежит в бандле,
 * — лучше чуть устаревший список, чем пустой раздел.
 */
const BUNDLED_ENTRIES = bundledChangelog.entries as ChangelogEntry[];

/**
 * Блок «Що нового» на головній.
 *
 * Джерело — згенерований tools/gen_changelog.mjs JSON з історії git: у PWA та Android-бандлі
 * історії коммитів немає, а human-readable список потрібен. Службні коміти (chore/docs) у
 * генератор не потрапляють, тож у списку лише те, що реально помітив користувач.
 *
 * Показуємо 5 останніх, решта — за кнопкою: повний список у бандлі займає місце, а читається
 * погано.
 */
export const ChangelogCard: React.FC = () => {
  const { t } = useTranslation();
  const { data } = useChangelog();
  const entries = (data?.data?.entries as ChangelogEntry[] | undefined) ?? BUNDLED_ENTRIES;
  // Данных нет только если генератор ещё не запускался — тогда блок просто не рисуем.
  if (entries.length === 0) return null;

  return (
    <details className="group/change rounded-2xl border border-border bg-card p-4 shadow-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-bold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          {t('home.whatsNew')}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          {entries.length} {t('changelog.entries')}
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/change:rotate-180" aria-hidden />
        </span>
      </summary>

      <ul className="mt-3 space-y-2">
        {entries.slice(0, 5).map((entry) => (
          <li key={entry.hash} className="flex gap-2.5">
            <span
              className={cn(
                'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg',
                entry.kind === 'new' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              {entry.kind === 'new' ? (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Wrench className="h-3.5 w-3.5" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-foreground">{entry.text}</p>
              <p className="mt-0.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                <span className="font-mono normal-case tracking-normal">{entry.hash}</span>
                <span aria-hidden>·</span>
                <time dateTime={entry.date}>{entry.date}</time>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
};