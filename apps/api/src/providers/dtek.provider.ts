/**
 * ДТЕК КЕМ — графики ГПВ и привязка улиц/домов (https://www.dtek-kem.com.ua/).
 *
 * Обёртка над `DtekKemAdapter` из parsers для интерфейса `RegionScheduleProvider`.
 * Покрывает: Киев (ke: Kyiv Energy, ДТЕК Кем).
 *
 * Персональных данных нет: только код очереди, дата, интервалы.
 * Адаптер также может отдавать привязку улиц к очередям через AJAX (getHomeNum).
 */
import { DtekKemAdapter } from '../parsers/ukraine-providers.adapter.js';
import type { ProviderSlot, ProviderSettlement, ProviderSnapshot, RegionScheduleProvider } from './types.js';
import { SLOT_STATE } from './intervals.js';

export const dtekProvider: RegionScheduleProvider = {
  id: 'dtek-kem',
  displayName: 'ДТЕК Кем',
  sourceUrl: 'https://www.dtek-kem.com.ua/',
  regions: ['kyiv-city'],

  async fetchSchedules(options): Promise<ProviderSnapshot> {
    const cookieHeader = process.env.DTEK_COOKIES ?? '';
    const dtek = new DtekKemAdapter({ cookieHeader });
    const { slots: rawSlots, streetsDictionary } = await dtek.fetchShutdownsPageAndSchedules();

    const slots: ProviderSlot[] = rawSlots
      .filter((slot) => slot.stateCode === 3 || slot.stateCode === 2)
      .map((slot) => {
        const state = SLOT_STATE[slot.stateCode as 3 | 2] ?? { name: 'Відключення', color: '#E33535' };
        return {
          region: slot.regionCpu,
          queue: slot.queue,
          date: slot.date,
          timeFrom: slot.timeFrom,
          timeTo: slot.timeTo,
          stateCode: slot.stateCode as 3 | 2,
          stateName: state.name,
          stateColor: state.color,
        };
      });

    // Streets dictionary как минимальные settlement-ы (группируем по улицам)
    const settlements: ProviderSettlement[] = [];
    const seenStreets = new Set<string>();
    for (const [street, queues] of Object.entries(streetsDictionary)) {
      if (seenStreets.has(street)) continue;
      seenStreets.add(street);
      settlements.push({
        region: 'kyiv-city',
        name: street,
        kind: null,
        queues: queues.map((q) => q.replace(/^GPV/i, '').replace(/[._]/g, '/')),
      });
    }

    return {
      providerId: this.id,
      fetchedAt: new Date(),
      slots,
      settlements,
    };
  },
};