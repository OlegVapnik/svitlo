/**
 * Mirror — всеукраинское зеркало ГПВ (https://dtek-api.svitlo-proxy.workers.dev/).
 *
 * Обёртка над `AllUkraineMirrorAdapter` из parsers для интерфейса `RegionScheduleProvider`.
 * Покрывает ВСЕ области Украины, которые отдаёт зеркало.
 *
 * Персональных данных нет: только код очереди, дата и получасовой код состояния.
 * Капчи нет, WAF нет.
 */
import { AllUkraineMirrorAdapter } from '../parsers/mirror-all-ukraine.adapter.js';
import type { ProviderSlot, ProviderSnapshot, RegionScheduleProvider } from './types.js';
import { SLOT_STATE } from './intervals.js';

export const mirrorProvider: RegionScheduleProvider = {
  id: 'mirror',
  displayName: 'Всеукраинское зеркало ГПВ',
  sourceUrl: process.env.MIRROR_SCHEDULE_URL ?? 'https://dtek-api.svitlo-proxy.workers.dev/',
  regions: [], // Определяется динамически из ответа зеркала

  async fetchSchedules(options): Promise<ProviderSnapshot> {
    const adapter = new AllUkraineMirrorAdapter(this.sourceUrl);
    const result = await adapter.fetchAllRegionsSchedules();

    // Маппим ParsedScheduleSlot → ProviderSlot
    const slots: ProviderSlot[] = result.slots
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

    // Возвращаем settlement-информацию из регионов (названия регионов как минимальные settlement-ы)
    const settlements = result.regions.map((reg) => ({
      region: reg.cpu,
      name: reg.nameUa,
      kind: null as unknown as 'місто' | 'смт' | 'село' | null,
      queues: reg.queues,
    }));

    return {
      providerId: this.id,
      fetchedAt: new Date(),
      slots,
      settlements,
    };
  },
};