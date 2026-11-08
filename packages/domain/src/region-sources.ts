/**
 * Реєстр джерел даних по регіонах — чистий домен, без I/O.
 *
 * Файл довідковий: звідки брати офіційні дані (домени обленерго), куди ходити
 * «в обхід» особового рахунку (публічний пошук адреси / «Чому немає світла»),
 * де є Telegram-канал оператора та дзеркало energy-ua.info. `cpu`-коди взяті
 * як є з каталогу регіонів (cf-worker `REGION_CATALOG` / packages/shared).
 *
 * Пріоритет джерел (Direct Official Sources First): прямі сайти, внутрішні API
 * та офіційні канали обленерго — ранг 3; сторонні агрегатори (energy-ua.info) —
 * лише останній резерв, ранг 1, і вони ніколи не перебивають офіційні дані.
 */

export interface RegionSource {
  /** cpu-код регіону, напр. 'chernihivska-oblast'. */
  region: string;
  /** Українська назва для інтерфейсу. */
  nameUa: string;
  /** Канонічні домени обленерго (перший — основний сайт). */
  officialDomains: string[];
  /**
   * Обхідна точка входу БЕЗ «особового рахунку»: публічний пошук адреси,
   * «Чому немає світла» або пряма таблиця черг на офіційному ресурсі оператора.
   */
  addressLookupBypassUrl: string;
  /** Лаконічна підказка до кнопки переходу (українською, без емодзі). */
  bypassHintUk: string;
  /** Telegram-канал обленерго, якщо є: t.me/s/{telegramChannel}. */
  telegramChannel: string | null;
  /** Хост дзеркала energy-ua.info (алфавітний індекс НП/черг), якщо існує. */
  mirrorHost: string | null;
}

/**
 * Реєстр: 24 регіони (kyiv-city — один регіон-місто). Луганська область
 * відсутня — оператора не обслуговується, джерел немає взагалі.
 *
 * Порядок диктує каталог регіонів за алфавітом `cpu`.
 *
 * Дзеркала звірені зі списком MIRROR_HOSTS у cf-worker/src/energy-ua-parse.ts;
 * для областей, яких там немає (ДТЕК-мережі, Херсон, Вінниця, Київ-місто,
 * Кіровоград…), — `null`.
 */
export const REGION_SOURCES: RegionSource[] = [
  {
    region: 'vinnytska-oblast',
    nameUa: 'Вінницька область',
    officialDomains: ['voe.com.ua'],
    addressLookupBypassUrl: 'https://www.voe.com.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: null,
  },
  {
    region: 'volynska-oblast',
    nameUa: 'Волинська область',
    officialDomains: ['energy.volyn.ua'],
    addressLookupBypassUrl: 'https://energy.volyn.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: null,
  },
  {
    region: 'dnipropetrovska-oblast',
    nameUa: 'Дніпропетровська область',
    officialDomains: ['dtek-dnem.com.ua'],
    addressLookupBypassUrl: 'https://www.dtek-dnem.com.ua/ua/shutdowns',
    bypassHintUk: 'Пошук за населеним пунктом, вулицею та будинком на сайті ДТЕК.',
    telegramChannel: null,
    mirrorHost: 'dnipro.energy-ua.info',
  },
  {
    region: 'donetska-oblast',
    nameUa: 'Донецька область',
    officialDomains: ['dtek-dem.com.ua'],
    addressLookupBypassUrl: 'https://www.dtek-dem.com.ua/ua/shutdowns',
    bypassHintUk: 'Пошук за населеним пунктом, вулицею та будинком на сайті ДТЕК.',
    telegramChannel: null,
    mirrorHost: null,
  },
  {
    region: 'zhytomyrska-oblast',
    nameUa: 'Житомирська область',
    officialDomains: ['ztoe.com.ua'],
    addressLookupBypassUrl: 'https://www.ztoe.com.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: 'zhytomyr.energy-ua.info',
  },
  {
    region: 'zakarpatska-oblast',
    nameUa: 'Закарпатська область',
    officialDomains: ['zakarpat.energy'],
    addressLookupBypassUrl: 'https://zakarpat.energy/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: 'zakarpat.energy-ua.info',
  },
  {
    region: 'zaporizka-oblast',
    nameUa: 'Запорізька область',
    officialDomains: ['zoe.com.ua'],
    addressLookupBypassUrl: 'https://www.zoe.com.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: 'zap.energy-ua.info',
  },
  {
    region: 'ivano-frankivska-oblast',
    nameUa: 'Івано-Франківська область',
    officialDomains: ['oe.if.ua', 'svitlo.oe.if.ua'],
    addressLookupBypassUrl: 'https://svitlo.oe.if.ua/',
    bypassHintUk: 'Портал графіків: пошук за населеним пунктом і вулицею.',
    telegramChannel: 'prykkarpattyaoblenergo_official',
    mirrorHost: 'prykarpattya.energy-ua.info',
  },
  {
    region: 'kyiv-city',
    nameUa: 'Київ',
    officialDomains: ['dtek-kem.com.ua'],
    addressLookupBypassUrl: 'https://www.dtek-kem.com.ua/ua/shutdowns',
    bypassHintUk: 'Пошук за вулицею та будинком на сайті ДТЕК Київські електромережі.',
    telegramChannel: null,
    mirrorHost: null,
  },
  {
    region: 'kyivska-oblast',
    nameUa: 'Київська область',
    officialDomains: ['dtek-krem.com.ua'],
    addressLookupBypassUrl: 'https://www.dtek-krem.com.ua/ua/shutdowns',
    bypassHintUk: 'Пошук за населеним пунктом, вулицею та будинком на сайті ДТЕК.',
    telegramChannel: null,
    mirrorHost: 'kyiv.energy-ua.info',
  },
  {
    region: 'kirovohradska-oblast',
    nameUa: 'Кіровоградська область',
    officialDomains: ['kiroe.com.ua'],
    addressLookupBypassUrl: 'https://www.kiroe.com.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: 'krop.energy-ua.info',
  },
  {
    region: 'lvivska-oblast',
    nameUa: 'Львівська область',
    officialDomains: ['loe.lviv.ua'],
    addressLookupBypassUrl: 'https://poweron.loe.lviv.ua/',
    bypassHintUk: 'Сервіс «Чому немає світла»: пошук за населеним пунктом і вулицею.',
    telegramChannel: 'lvivoblenergo',
    mirrorHost: 'lviv.energy-ua.info',
  },
  {
    region: 'mykolaivska-oblast',
    nameUa: 'Миколаївська область',
    officialDomains: ['energy.mk.ua'],
    addressLookupBypassUrl: 'https://off.energy.mk.ua/',
    bypassHintUk: 'Пряма таблиця черг за населеним пунктом і вулицею.',
    telegramChannel: null,
    mirrorHost: null,
  },
  {
    region: 'odeska-oblast',
    nameUa: 'Одеська область',
    officialDomains: ['dtek-oem.com.ua'],
    addressLookupBypassUrl: 'https://www.dtek-oem.com.ua/ua/shutdowns',
    bypassHintUk: 'Пошук за населеним пунктом, вулицею та будинком на сайті ДТЕК.',
    telegramChannel: null,
    mirrorHost: null,
  },
  {
    region: 'poltavska-oblast',
    nameUa: 'Полтавська область',
    officialDomains: ['poe.pl.ua'],
    addressLookupBypassUrl: 'https://poe.pl.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: 'energy-ua.info',
  },
  {
    region: 'rivnenska-oblast',
    nameUa: 'Рівненська область',
    officialDomains: ['vsei.ua'],
    addressLookupBypassUrl: 'https://www.vsei.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: 'rivne.energy-ua.info',
  },
  {
    region: 'sumska-oblast',
    nameUa: 'Сумська область',
    officialDomains: ['soe.com.ua'],
    addressLookupBypassUrl: 'https://www.soe.com.ua/',
    bypassHintUk: 'Вкладка пошуку за адресою на сторінці ГПВ — без авторизації.',
    telegramChannel: 'SumyEnergo',
    mirrorHost: 'sumy.energy-ua.info',
  },
  {
    region: 'ternopilska-oblast',
    nameUa: 'Тернопільська область',
    officialDomains: ['toe.com.ua'],
    addressLookupBypassUrl: 'https://poweron.toe.com.ua/',
    bypassHintUk: 'Сервіс «Чому немає світла»: пошук за населеним пунктом і вулицею.',
    telegramChannel: null,
    mirrorHost: 'ternopil.energy-ua.info',
  },
  {
    region: 'kharkivska-oblast',
    nameUa: 'Харківська область',
    officialDomains: ['oblenergo.kharkov.ua'],
    addressLookupBypassUrl: 'https://oblenergo.kharkov.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: 'kharkiv.energy-ua.info',
  },
  {
    region: 'khersonska-oblast',
    nameUa: 'Херсонська область',
    officialDomains: ['ksoe.com.ua'],
    addressLookupBypassUrl: 'https://www.ksoe.com.ua/',
    bypassHintUk: 'Вкладка «Пошук за адресою» на сайті обленерго — без авторизації.',
    telegramChannel: null,
    mirrorHost: null,
  },
  {
    region: 'khmelnytska-oblast',
    nameUa: 'Хмельницька область',
    officialDomains: ['hoe.com.ua'],
    addressLookupBypassUrl: 'https://www.hoe.com.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: 'khmel.energy-ua.info',
  },
  {
    region: 'cherkaska-oblast',
    nameUa: 'Черкаська область',
    officialDomains: ['cherkasyoblenergo.com'],
    addressLookupBypassUrl: 'https://cherkasyoblenergo.com/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: null,
  },
  {
    region: 'chernivetska-oblast',
    nameUa: 'Чернівецька область',
    officialDomains: ['oblenergo.cv.ua'],
    addressLookupBypassUrl: 'https://oblenergo.cv.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: null,
    mirrorHost: 'chernivtsi.energy-ua.info',
  },
  {
    region: 'chernihivska-oblast',
    nameUa: 'Чернігівська область',
    officialDomains: ['chernihivoblenergo.com.ua'],
    addressLookupBypassUrl: 'https://chernihivoblenergo.com.ua/',
    bypassHintUk: 'Публічний пошук адреси на офіційному сайті оператора.',
    telegramChannel: 'chernigivoblenergo',
    mirrorHost: 'chernigiv.energy-ua.info',
  },
];

/** Реєстр по `cpu`-коду. */
const SOURCES_BY_REGION = new Map(REGION_SOURCES.map((entry) => [entry.region, entry]));

/** Джерело регіону або `null`, якщо регіон нам невідомий (напр. луганська). */
export function regionSourceOf(region: string): RegionSource | null {
  return SOURCES_BY_REGION.get(String(region ?? '').trim()) ?? null;
}

/**
 * Кнопка «перевірити адресу на сайті оператора» для майстра вибору черги.
 *
 * `null`, якщо регіон невідомий: вигадувати посилання не можна — людина піде на чужий
 * сайт і не знайде там своєї адреси.
 */
export function addressBypassOf(
  region: string,
): { url: string; hintUk: string; nameUa: string } | null {
  const source = regionSourceOf(region);
  if (!source) return null;
  return {
    url: source.addressLookupBypassUrl,
    hintUk: source.bypassHintUk,
    nameUa: source.nameUa,
  };
}
