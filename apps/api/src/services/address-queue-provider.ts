/**
 * Провайдеры «адрес → группа» из открытых официальных источников.
 *
 * Разведка (18.10.2026) показала: публичные страницы ДТЕК и API Yasno закрыты Incapsula
 * (HTTP 200 + JS-челлендж/iframe), а не логином. Обходить WAF запрещено правилами проекта,
 * поэтому ни один провайдер не объявлен открытым. Интерфейс оставлен, чтобы подключить
 * источник можно было без переписывания маршрута — но только после того, как он реально
 * откроется и будет проверен.
 */
export interface AddressProviderInput {
  region: string;
  settlement: string;
  street: string;
  house?: string;
}

export interface AddressProviderHit {
  housePattern: string;
  queue: string;
}

export interface AddressQueueProvider {
  readonly id: string;
  /** Области, которые обслуживает источник. */
  readonly regions: readonly string[];
  /** `open` — без логина/капчи; `closed` — использовать нельзя. */
  readonly access: 'open' | 'closed';
  lookup(input: AddressProviderInput): Promise<AddressProviderHit[]>;
}

/**
 * DTEK КЕМ умеет отдавать дома улицы вместе с группами (`POST /ua/ajax`, getHomeNum), но
 * сейчас сайт закрыт Incapsula. Код адаптера остаётся в парсерах для ручного импорта, а в
 * публичном поиске этот провайдер не вызывается.
 */
export const ADDRESS_QUEUE_PROVIDERS: readonly AddressQueueProvider[] = [];

/**
 * Возвращает дома только от провайдера с `access: 'open'`. Если открытых источников для
 * области нет — пустой массив, и UI показывает соседние дома/ручной выбор.
 */
export async function lookupOpenAddressProviders(input: AddressProviderInput): Promise<AddressProviderHit[]> {
  const provider = ADDRESS_QUEUE_PROVIDERS.find(
    (candidate) => candidate.access === 'open' && candidate.regions.includes(input.region),
  );
  if (!provider) return [];
  try {
    return await provider.lookup(input);
  } catch {
    // Источник может упасть в любой момент. Это не ошибка поиска адреса: показываем ручной
    // выбор, а не 500.
    return [];
  }
}
