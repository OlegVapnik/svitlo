/**
 * YASNO — графики ГПВ по областям присутствия (https://yasno.ua/).
 *
 * Обёртка над `YasnoScheduleAdapter` из parsers для интерфейса `RegionScheduleProvider`.
 * Покрывает: Киев, Днепропетровскую область (и другие регионы по мере добавления).
 *
 * Персональных данных нет: только код очереди, дата и получасовой код состояния.
 */
import { YasnoScheduleAdapter } from '../parsers/ukraine-providers.adapter.js';
import type { ProviderSlot, ProviderSnapshot, RegionScheduleProvider } from './types.js';
import { SLOT_STATE } from './intervals.js';

export const yasnoProvider: RegionScheduleProvider = {
  id: 'yasno',
  displayName: 'YASNO',
  sourceUrl: 'https://api.yasno.com.ua/api/v1/pages/home/schedule-turn-off-electricity',
  regions: ['kyiv-city', 'dnipropetrovska-oblast'],

  async fetchSchedules(_options): Promise<ProviderSnapshot> {
    const adapter = new YasnoScheduleAdapter();
    const rawSlots = await adapter.fetchSchedules();

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

    return {
      providerId: this.id,
      fetchedAt: new Date(),
      slots,
      // YASNO не отдаёт список сёл/улиц — только графики
      settlements: [],
    };
  },
};