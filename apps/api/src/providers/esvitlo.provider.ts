/**
 * e-svitlo (Черніговобленерго, https://cn.e-svitlo.com.ua/) — графики ГПВ.
 *
 * На данный момент e-svitlo использует тот же backend /api/info_schedule_part,
 * что и Черніговобленерго, но с другой базой. Пока возвращаем пустой снапшот —
 * провайдер будет активирован после тестирования эндпоинта.
 *
 * Персональных данных нет: только код очереди, дата, интервалы.
 */
import type { ProviderSnapshot, RegionScheduleProvider } from './types.js';

export const esvitloProvider: RegionScheduleProvider = {
  id: 'esvitlo-cn',
  displayName: 'e-svitlo (Черніговобленерго)',
  sourceUrl: 'https://cn.e-svitlo.com.ua/',
  regions: ['chernihivska-oblast'],

  async fetchSchedules(_options): Promise<ProviderSnapshot> {
    // TODO: реализовать парсинг e-svitlo когда станет доступен API/эндпоинт
    return {
      providerId: this.id,
      fetchedAt: new Date(),
      slots: [],
      settlements: [],
    };
  },
};