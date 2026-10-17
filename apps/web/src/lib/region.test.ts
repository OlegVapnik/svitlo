import { describe, expect, test } from 'vitest';
import { REGION_CATALOG, canonicalRegionCpu } from '@svitlo/shared';
import {
  DEFAULT_REGION,
  DEFAULT_REGION_NAME_UA,
  REGION_STORAGE_KEY,
  filterRegions,
  formatRegionOption,
  getStoredRegion,
  isRegionCpu,
  normalizeRegionCpu,
  regionDataBadge,
  regionOptions,
  setStoredRegion,
  type RegionSummary,
} from './region';

describe('multi-region helper', () => {
  test('константи відповідають замороженому контракту /tmp/API-CONTRACT-regions.md', () => {
    expect(DEFAULT_REGION).toBe('chernihivska-oblast');
    expect(DEFAULT_REGION_NAME_UA).toBe('Чернігівська область');
    expect(REGION_STORAGE_KEY).toBe('svitlo_region');
  });

  test('isRegionCpu валідує kebab-case ідентифікатори', () => {
    expect(isRegionCpu('chernihivska-oblast')).toBe(true);
    expect(isRegionCpu('kyiv-city')).toBe(true);
    expect(isRegionCpu('lvivska-oblast')).toBe(true);
    expect(isRegionCpu('')).toBe(false);
    expect(isRegionCpu('Чернігів')).toBe(false);
    expect(isRegionCpu('kyiv_city')).toBe(false);
    expect(isRegionCpu(null)).toBe(false);
  });

  test('normalizeRegionCpu повертає очищений cpu або дефолт', () => {
    expect(normalizeRegionCpu('  KYIV-CITY  ')).toBe('kyiv-city');
    expect(normalizeRegionCpu('invalid cpu!')).toBe('chernihivska-oblast');
    expect(normalizeRegionCpu(undefined)).toBe('chernihivska-oblast');
  });

  test('getStoredRegion та setStoredRegion коректно взаємодіють зі сховищем', () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
    };

    // Початково порожнє сховище повертає DEFAULT_REGION
    expect(getStoredRegion(mockStorage)).toBe('chernihivska-oblast');

    // Запис валідного регіону
    setStoredRegion('kyiv-city', mockStorage);
    expect(store.get(REGION_STORAGE_KEY)).toBe('kyiv-city');
    expect(getStoredRegion(mockStorage)).toBe('kyiv-city');

    // Запис невалідного значення фолбечить на DEFAULT_REGION
    setStoredRegion('невідома область', mockStorage);
    expect(getStoredRegion(mockStorage)).toBe('chernihivska-oblast');
  });

  test('старі коди областей мігрують до канонічних (сторож розходження з @svitlo/shared)', () => {
    // ЧОМУ: каталог раніше віддавав ключі фіда (`kyiv`, `kiivska-oblast`), і ці коди лишились у людей
    // у `localStorage`, закладках і посиланнях. Після переходу на канонічні `cpu` пошук рядка каталога
    // за старим кодом не знаходив нічого: на головній зникали кнопки груп («Черга:» порожня) і
    // показувалось «Даних графіка немає» при живому графіку. Таблиця в `region.ts` — копія правил
    // сервера, і цей тест не дає їм розійтись.
    expect(normalizeRegionCpu('kyiv')).toBe('kyiv-city');
    expect(normalizeRegionCpu('kiivska-oblast')).toBe('kyivska-oblast');
    expect(normalizeRegionCpu('dnipropetrovnska-oblast')).toBe('dnipropetrovska-oblast');
    for (const legacy of ['kyiv', 'kiivska-oblast', 'dnipropetrovnska-oblast']) {
      expect(normalizeRegionCpu(legacy)).toBe(canonicalRegionCpu(legacy));
    }
    // Ключ фіда області з ОДНІЄЮ мережею завжди веде до її канонічного `cpu`. Мережі
    // багатомережної області (`dnipro-cek`, `dnipro-dnem`) — це окремий вибір людини, а не алиас:
    // підміняти їх областю означало б втратити вибір мережі.
    for (const entry of REGION_CATALOG) {
      expect(normalizeRegionCpu(entry.cpu)).toBe(entry.cpu);
      if (entry.feedKeys.length !== 1) continue;
      const feedKey = entry.feedKeys[0]!;
      expect(normalizeRegionCpu(feedKey)).toBe(entry.cpu);
    }
  });

  test('getStoredRegion перезаписує старий код у сховищі, а не повертає його щоразу', () => {
    // ЧОМУ: без перезапису міграція була б вічною — старий ключ лежав би в сховищі й повертався при
    // кожному старті, а сторінки з посиланням `?region=kyiv` лишались би з чужою версією коду.
    const store = new Map<string, string>([[REGION_STORAGE_KEY, 'kyiv']]);
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    };
    expect(getStoredRegion(mockStorage)).toBe('kyiv-city');
    expect(store.get(REGION_STORAGE_KEY)).toBe('kyiv-city');
  });

  test('formatRegionOption формує зрозумілий підпис', () => {
    const regionWithQueues: RegionSummary = {
      cpu: 'chernihivska-oblast',
      nameUa: 'Чернігівська область',
      nameEn: null,
      queues: ['1/1', '2/2'],
      slots: 96,
      lastDate: '2026-10-11',
    };
    expect(formatRegionOption(regionWithQueues)).toBe('Чернігівська область (2)');

    const regionNoQueues: RegionSummary = {
      cpu: 'lvivska-oblast',
      nameUa: 'Львівська область',
      nameEn: null,
      queues: [],
      slots: 0,
      lastDate: null,
    };
    expect(formatRegionOption(regionNoQueues)).toBe('Львівська область');
  });

  test('regionDataBadge розрізняє «є слоти», «світло за графіком» і «не знаємо»', () => {
    // Є імпортовані слоти — показуємо саме їх, навіть якщо оператор уже опублікував «без відключень».
    expect(regionDataBadge({ slots: 96, allClear: true })).toBe('slots');
    expect(regionDataBadge({ slots: 2, allClear: false })).toBe('slots');
    // Слотів немає, але ГПВ на сьогодні опубліковано без годин відключення (dnipro-cek 17.10.2026).
    expect(regionDataBadge({ slots: 0, allClear: true })).toBe('allClear');
    // Ні слотів, ні публікації: «даних немає» — це «не знаємо», а не «світло є».
    expect(regionDataBadge({ slots: 0, allClear: false })).toBe('noData');
    expect(regionDataBadge({ slots: 0 })).toBe('noData');
  });

  test('regionOptions показує область із кількома мережами як групу, а мережі — як вибір', () => {
    // Так каталог віддає м. Дніпро: одна область із двома ключами фіда (ЦЕК і ДнЕМ) і дві підобласті.
    const regions: RegionSummary[] = [
      { cpu: 'lvivska-oblast', nameUa: 'Львівська область', nameEn: null, queues: ['1/1'], slots: 3, lastDate: null, feedKeys: ['lvivska-oblast'] },
      { cpu: 'dnipropetrovska-oblast', nameUa: 'Дніпропетровська область', nameEn: null, queues: ['1/1'], slots: 4, lastDate: null, feedKeys: ['dnipro-cek', 'dnipro-dnem'] },
      { cpu: 'dnipro-dnem', nameUa: 'м. Дніпро (ДнЕМ)', nameEn: null, queues: ['1/1'], slots: 2, lastDate: null, feedKeys: ['dnipro-dnem'], parentCpu: 'dnipropetrovska-oblast' },
      { cpu: 'dnipro-cek', nameUa: 'м. Дніпро (ЦЕК)', nameEn: null, queues: ['1/1'], slots: 2, lastDate: null, feedKeys: ['dnipro-cek'], parentCpu: 'dnipropetrovska-oblast' },
      { cpu: 'odeska-oblast', nameUa: 'Одеська область', nameEn: null, queues: [], slots: 0, lastDate: null, feedKeys: [] },
    ];

    const options = regionOptions(regions);

    // Звичайні області вибираються завжди, навіть коли фід їх не віддає (тоді чесно «немає даних»).
    expect(options.find((option) => option.region.cpu === 'lvivska-oblast')).toMatchObject({ depth: 0, isGroup: false });
    expect(options.find((option) => option.region.cpu === 'odeska-oblast')).toMatchObject({ depth: 0, isGroup: false });
    // Область із кількома мережами — лише заголовок: «графік області цілком» не існує.
    expect(options.find((option) => option.region.cpu === 'dnipropetrovska-oblast')).toMatchObject({ isGroup: true });
    // Мережі йдуть під своєю областю, з відступом.
    const groupIndex = options.findIndex((option) => option.region.cpu === 'dnipropetrovska-oblast');
    expect(options.slice(groupIndex + 1, groupIndex + 3).every((option) => option.depth === 1)).toBe(true);
    expect(options.slice(groupIndex + 1, groupIndex + 3).map((option) => option.region.cpu).sort()).toEqual([
      'dnipro-cek',
      'dnipro-dnem',
    ]);

    // Дитина, чийого батька немає в списку (обріз даних, старий кеш), не зникає — стає звичайною областю.
    const orphan = regionOptions([
      { cpu: 'dnipro-cek', nameUa: 'м. Дніпро (ЦЕК)', nameEn: null, queues: [], slots: 0, lastDate: null, feedKeys: ['dnipro-cek'], parentCpu: 'dnipropetrovska-oblast' },
    ]);
    expect(orphan).toHaveLength(1);
    expect(orphan[0]).toMatchObject({ depth: 0, isGroup: false });
  });

  test('filterRegions зберігає батьківську область, коли збіглася лише назва мережі', () => {
    const regions: RegionSummary[] = [
      { cpu: 'dnipropetrovska-oblast', nameUa: 'Дніпропетровська область', nameEn: null, queues: [], slots: 0, lastDate: null, feedKeys: ['dnipro-cek', 'dnipro-dnem'] },
      { cpu: 'dnipro-cek', nameUa: 'м. Дніпро (ЦЕК)', nameEn: null, queues: [], slots: 0, lastDate: null, feedKeys: ['dnipro-cek'], parentCpu: 'dnipropetrovska-oblast' },
      { cpu: 'dnipro-dnem', nameUa: 'м. Дніпро (ДнЕМ)', nameEn: null, queues: [], slots: 0, lastDate: null, feedKeys: ['dnipro-dnem'], parentCpu: 'dnipropetrovnska-oblast' },
      { cpu: 'lvivska-oblast', nameUa: 'Львівська область', nameEn: 'Lviv Oblast', queues: [], slots: 0, lastDate: null, feedKeys: ['lvivska-oblast'] },
    ];

    // Пошук «Дніпро» знаходить мережі — і залишає їхню область, інакше мережа «висить» без батька.
    expect(filterRegions(regions, 'дніпро').map((region) => region.cpu)).toContain('dnipropetrovska-oblast');
    expect(filterRegions(regions, 'дніпро').map((region) => region.cpu)).toContain('dnipro-cek');
    // Пошук області лишає видимими її мережі, щоб було з чого вибирати.
    expect(filterRegions(regions, 'дніпропетровська').map((region) => region.cpu)).toContain('dnipro-cek');
    // Мережа з батьком, якого немає в списку (обріз даних, старий кеш), не зникає сама по собі.
    expect(filterRegions(regions, 'дніпро').map((region) => region.cpu)).toContain('dnipro-dnem');
    // Пошук англійською і за cpu працює як раніше.
    expect(filterRegions(regions, 'lviv').map((region) => region.cpu)).toEqual(['lvivska-oblast']);
    expect(filterRegions(regions, 'lvivska-oblast').map((region) => region.cpu)).toEqual(['lvivska-oblast']);
    // Порожній запит повертає каталог без змін.
    expect(filterRegions(regions, '  ')).toHaveLength(regions.length);
  });
});
