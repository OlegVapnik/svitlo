/**
 * Черніговобленерго — аварийные/ремонтные/режимные отключения + графики ГПВ
 * (https://chernihivoblenergo.com.ua/).
 *
 * Обёртка над `ChernihivOblenergoFullAdapter` из parsers для интерфейса `RegionScheduleProvider`.
 * Покрывает: Черниговскую область (сёла/города по list_acc типы 1, 2, 6).
 *
 * Персональных данных нет: только населённый пункт, улица, дома, время, причина.
 */
import { ChernihivOblenergoFullAdapter } from '../parsers/ukraine-providers.adapter.js';
import type { ProviderSlot, ProviderSettlement, ProviderSnapshot, RegionScheduleProvider } from './types.js';
import { SLOT_STATE } from './intervals.js';

export const chernihivOblenergoProvider: RegionScheduleProvider = {
  id: 'chernihivoblenergo',
  displayName: 'Черніговобленерго',
  sourceUrl: 'https://chernihivoblenergo.com.ua/',
  regions: ['chernihivska-oblast'],

  async fetchSchedules(options): Promise<ProviderSnapshot> {
    const cityIdsRaw = process.env.CHERNIHIV_CITY_IDS ?? '';
    const cityIds = cityIdsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (cityIds.length === 0) {
      return {
        providerId: this.id,
        fetchedAt: new Date(),
        slots: [],
        settlements: [],
      };
    }

    const turnstileToken = process.env.CHERNIHIV_TURNSTILE_TOKEN ?? undefined;
    const adapter = new ChernihivOblenergoFullAdapter({
      cityIds,
      turnstileToken,
    });

    const outageRecords = await adapter.fetchOutagesBySettlements();

    // Из записей list_acc извлекаем населённые пункты и их улицы
    const settlementMap = new Map<string, { name: string; streets: Set<string> }>();
    for (const rec of outageRecords) {
      const key = rec.settlement.trim();
      if (!settlementMap.has(key)) {
        settlementMap.set(key, { name: rec.settlement, streets: new Set() });
      }
      if (rec.street) {
        const entry = settlementMap.get(key)!;
        entry.streets.add(rec.street);
      }
    }

    // Строим settlement-список (села/города с улицами)
    const settlements: ProviderSettlement[] = [];
    for (const [, entry] of settlementMap) {
      settlements.push({
        region: 'chernihivska-oblast',
        name: entry.name,
        kind: 'село',
        queues: [],
        sourceRef: null,
      });
    }

    // Слоты ГПВ пока не отдаём через этот провайдер — для графиков используется mirror
    return {
      providerId: this.id,
      fetchedAt: new Date(),
      slots: [],
      settlements,
    };
  },
};