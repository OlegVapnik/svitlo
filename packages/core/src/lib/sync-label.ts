import type { SyncState } from '../api/offline-sync';

/**
 * Какую подпись показать в индикаторе синхронизации.
 *
 * Правило — в чистой функции, потому что одна ошибка в нём уже стоила доверия: при живом
 * интернете и исчерпанной квоте базы шапка писала «Без зв’язку, 14 годин тому», и человек шёл
 * проверять Wi-Fi. Виноват был сервер, и совет должен быть другим.
 *
 * Ключ возвращаем, а не готовую строку: перевод живёт в i18n, а `when` подставляет вызывающий.
 */
export type SyncLabelKey =
  | 'offline.syncSyncing'
  | 'offline.syncFresh'
  | 'offline.syncStored'
  | 'offline.syncOffline'
  | 'offline.syncOfflineNoData'
  | 'offline.syncServerError'
  | 'offline.syncServerErrorNoData'
  | 'offline.syncIdle';

export function syncLabelKey(state: Pick<SyncState, 'phase' | 'syncedAt' | 'errorKind'>): SyncLabelKey {
  const hasWhen = Boolean(state.syncedAt);
  switch (state.phase) {
    case 'syncing':
      return 'offline.syncSyncing';
    case 'fresh':
      return 'offline.syncFresh';
    case 'stored':
      return 'offline.syncStored';
    case 'offline':
      // Сервер ответил ошибкой — это не «нет связи»: подпись называет виновника.
      if (state.errorKind === 'server') {
        return hasWhen ? 'offline.syncServerError' : 'offline.syncServerErrorNoData';
      }
      return hasWhen ? 'offline.syncOffline' : 'offline.syncOfflineNoData';
    default:
      return 'offline.syncIdle';
  }
}
