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
import { settlementsForRegion, type DirectorySettlement } from './settlement-directory.js';

const REGION = 'chernihivska-oblast';

/** «селище» у КОАТТГ і «смт» у нашому типів ProviderSettlement — те саме поняття. */
function toProviderKind(kind: string | undefined): 'місто' | 'смт' | 'село' | null {
  if (kind === 'місто') return 'місто';
  if (kind === 'селище') return 'смт';
  if (kind === 'село') return 'село';
  return null;
}

export const chernihivOblenergoProvider: RegionScheduleProvider = {
  id: 'chernihivoblenergo',
  displayName: 'Черніговобленерго',
  sourceUrl: 'https://chernihivoblenergo.com.ua/',
  regions: [REGION],

  async fetchSchedules(options): Promise<ProviderSnapshot> {
    // Явний перелік у CHERNIHIV_CITY_IDS має пріоритет (так можна вручну точково перевірити
    // конкретне село). Інакше беремо довідник КОАТУУ — інакше область не обходитися ніколи.
    const cityIdsRaw = process.env.CHERNIHIV_CITY_IDS ?? '';
    const explicitCityIds = cityIdsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Явний перелік у CHERNIHIV_CITY_IDS має пріоритет (так можна точково перевірити одне
    // село). Інакше — довідник КОАТУУ: область з 1509 НП інакше не обходиться ніколи.
    const directory = settlementsForRegion(REGION);
    const cityIds =
      explicitCityIds.length > 0 ? explicitCityIds : directory.map((item) => item.koatuu);

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

    // Строим settlement-список (села/города с улицами).
    // Тип НП берем из справочника КОАТУУ по коду города, а не пишем «село» всем подряд:
    // раньше Бахмач/Ніжин тоже помечались как село, и подпись в UI была неверной.
    const directoryByKoatuu = new Map(directory.map((item) => [item.koatuu, item]));
    const settlements: ProviderSettlement[] = [];
    for (const [cityId, entry] of settlementMap) {
      settlements.push({
        region: REGION,
        name: directoryByKoatuu.get(cityId)?.name ?? entry.name,
        // Тип з довідника приводимо до типу провайдера: реєстр має ще й «селище», провайдер — «смт».
        kind: toProviderKind(directoryByKoatuu.get(cityId)?.kind),
        queues: [],
        // Код КОАТУУ: он же идентификатор в ответе оператора, по нему обновляем запись,
        // а не ищем по названию (которую оператор пишет капсом: ДЕСНЯНСЬКЕ).
        sourceRef: cityId,
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