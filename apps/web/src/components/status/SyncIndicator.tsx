import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CloudCheck, CloudOff, Database, RefreshCw, RotateCw, WifiOff } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { useRegion } from '../../hooks/useRegion.js';
import { useSyncStatus } from '../../hooks/useOfflineSync.js';
import { syncNow } from '../../api/offline-sync.js';
import { formatDateTime, formatRelative } from '../../lib/date.js';
import type { SyncState } from '../../api/offline-sync.js';

/**
 * Индикатор синхронизации офлайн-пакета для шапки.
 *
 * Зачем отдельно от FreshnessChip: тот показывает, когда оператор в последний раз обновил данные
 * (источник), а этот — знает ли телефон вообще что-нибудь про текущую область. Это разные
 * ситуации: «источник молчит с утра» и «пакета нет, потому что на этом телефоне ещё ни разу не
 * было связи». Раньше обе выглядели одинаково — пустым экраном.
 *
 * Смысл подписи — возраст данных, а не время запроса: `syncedAt` приходит из пакета. Если
 * показать время последней проверки, вчерашний график будет выглядеть свежим.
 *
 * Движок синхронизации (таймер и обработчики сети) живёт один на приложение — в useOfflineSync()
 * внутри AppShell. Здесь только подписка на состояние: второй экземпляр движка слал бы по два
 * запроса на каждое событие.
 */
const STYLES = {
  fresh: { icon: CloudCheck, className: 'text-success', animation: null },
  syncing: { icon: RotateCw, className: 'text-on-surface-variant', animation: 'animate-spin' },
  stored: { icon: Database, className: 'text-warning', animation: null },
  offline: { icon: WifiOff, className: 'text-warning', animation: 'animate-pulse-soft' },
  idle: { icon: CloudOff, className: 'text-on-surface-variant', animation: null },
} as const;

function labelFor(state: SyncState, t: TFunction): string {
  const when = state.syncedAt ? formatRelative(state.syncedAt) : null;
  switch (state.phase) {
    case 'syncing':
      return t('offline.syncSyncing');
    case 'fresh':
      return t('offline.syncFresh', { when: when ?? t('common.noData') });
    case 'stored':
      return t('offline.syncStored', { when: when ?? t('common.noData') });
    case 'offline':
      return state.syncedAt ? t('offline.syncOffline', { when: formatRelative(state.syncedAt) }) : t('offline.syncOfflineNoData');
    default:
      return t('offline.syncIdle');
  }
}

export const SyncIndicator = () => {
  const { t } = useTranslation();
  const { currentRegion } = useRegion();
  const state = useSyncStatus();
  const style = STYLES[state.phase];
  const Icon = style.icon;
  const label = labelFor(state, t);

  // Подсказка: точное время сборки пакета и сколько НП лежит на устройстве. Счётчики помогают
  // разобраться на месте («поиск адреса в офлайне пустой» = пакет не сохранён, а не «поиск сломан»).
  const tooltip = [
    state.syncedAt ? `${t('offline.syncedAt')}: ${formatDateTime(state.syncedAt)}` : t('offline.neverSynced'),
    state.checkedAt ? `${t('status.lastUpdated')}: ${formatDateTime(state.checkedAt)}` : null,
    state.settlements > 0 ? t('offline.settlementsSaved', { shown: state.settlements }) : null,
    state.error ? t('offline.syncFailed', { error: state.error }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span className="hidden items-center gap-0.5 sm:inline-flex">
      {/* M3 Assist Chip: иконка состояния + подпись, а внутри чипа — кнопка «оновити».
          Раньше это были отдельные «метка» и кнопка, и кнопку искали отдельно от состояния. */}
      <span
        title={tooltip || undefined}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-surface-container py-1 pl-2.5 pr-1 text-[11px] font-semibold',
          style.className,
        )}
      >
        <Icon className={cn('h-3.5 w-3.5', style.animation)} strokeWidth={2.2} aria-hidden />
        <span className="max-w-[12rem] truncate">{label}</span>
        <button
          type="button"
          onClick={() => void syncNow(currentRegion)}
          disabled={state.phase === 'syncing'}
          title={t('offline.syncNow')}
          aria-label={t('offline.syncNow')}
          className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
        </button>
      </span>
    </span>
  );
};
