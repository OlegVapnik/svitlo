/**
 * Контракт «провайдера графіків відключень» (region schedule provider).
 *
 * Навіщо: публічні графіки живуть у РІЗНИХ джерелах — дзеркало DTEK (`MIRROR_SCHEDULE_URL`),
 * API YASNO, кабінет e-svitlo/Чернігівобленерго, сайти ДСО. Формати різні, тому КОЖНЕ джерело —
 * окремий модуль за цим інтерфейсом.
 *
 * Правила для провайдера (skills/scraper-adapter-hardening):
 * 1. Провайдер ЧИСТИЙ: мережа → дані. Він НІКОЛИ не пише в БД (це робить provider-sync.service.ts).
 * 2. Відповідь джерела парсимо zod-схемою на межі; невідомі поля ігноруємо, зламаний формат → throw.
 * 3. Ніяких вигаданих даних: немає даних → порожній масив `slots`, а не «схоже на правду».
 * 4. Ніяких персональних даних (номери особових рахунків, телефони, ПІБ) — лише черги/дати/години.
 * 5. Час у полях — київський настінний (`timeFrom`/`timeTo`), дата — київська календарна.
 */
export interface ProviderSlot {
  /** cpu області з каталогу `regions` (напр. 'chernihivska-oblast', 'kyiv', 'dnipro-cek'). */
  region: string;
  /** Черга у форматі застосунку: '2/2' (джерела з '2.2'/'2_2' нормалізуємо на меіжі). */
  queue: string;
  /** Київська календарна дата YYYY-MM-DD. */
  date: string;
  /** Початок інтервалу, київський настінний час HH:MM. */
  timeFrom: string;
  /** Кінець інтервалу HH:MM ('00:00' = кінець доби). */
  timeTo: string;
  /** Код стану за легендою оператора: 3 — відключення, 2 — можливе відключення. */
  stateCode: 3 | 2;
  /** Назва стану людською мовою ('Відключення'), без вигадок. */
  stateName: string;
  /** Колір банера у UI (як у решті шляхів імпорту). */
  stateColor: string;
}

/**
 * Населений пункт (село/смт/місто) з джерела провайдера. Саме це дозволяє людині обрати
 * «своє село → свою чергу», тому провайдери, що мають такі списки, ЗОБОВ'ЯЗАНІ їх віддавати.
 */
export interface ProviderSettlement {
  /** cpu області з каталогу `regions`. */
  region: string;
  /** Назва, як у джерелі (без «с.»/«смт» — окремо в `kind`). */
  name: string;
  kind?: 'місто' | 'смт' | 'село' | null;
  /** Черги населеного пункту; порожньо = джерело не каже (не вигадувати). */
  queues: string[];
  /** Ідентифікатор у джерелі (напр. cityId) — щоб повторно звертатися саме до нього. */
  sourceRef?: string | null;
}

export interface ProviderSnapshot {
  /** Дорівнює `RegionScheduleProvider.id`. */
  providerId: string;
  fetchedAt: Date;
  /** Лише відключення/можливі відключення («світло є» у БД не пишемо — як у дзеркалі). */
  slots: ProviderSlot[];
  /** Населені пункти і їхні черги (якщо джерело їх дає; інакше [] — не вигадувати). */
  settlements?: ProviderSettlement[];
  /** Скільки рядків джерела відкинуто як невалідні (для моніторингу drift-у формату). */
  rejected?: number;
}

export interface RegionScheduleProvider {
  /** Стабільний id: 'mirror' | 'yasno' | 'dtek-kem' | 'esvitlo-cn' | 'chernihivoblenergo'. */
  readonly id: string;
  readonly displayName: string;
  /** URL/опис джерела для моніторингу (видно в /status і в parse_runs). */
  readonly sourceUrl: string;
  /** Які cpu областей провайдер покриває (для чесного «даних немає» замість чужих даних). */
  readonly regions: string[];
  fetchSchedules(options?: { fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<ProviderSnapshot>;
}
