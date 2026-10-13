/**
 * Класифікатор текстів новин:
 * - визначення регіону (region_cpu) за назвами міст, областей та прикметниками у різних відмінках;
 * - розрізнення міста Києва ('kyiv') та Київської області ('kiivska-oblast');
 * - прапорець загальноукраїнської новини is_ukraine_wide;
 * - категорія kind ('outage', 'schedule-change', 'repair', 'emergency', 'ukraine', 'other');
 * - тематичні теги tags.
 */
import type { NewsKind } from '@svitlo/shared';

interface RegionRule {
  cpu: string;
  patterns: RegExp[];
  negativePatterns?: RegExp[];
}

const REGION_RULES: RegionRule[] = [
  {
    cpu: 'chernihivska-oblast',
    patterns: [
      /чернігівськ/iu,
      /чернігівщин/iu,
      /(?<=^|[^\p{L}])чернігів(?=$|[^\p{L}])/iu,
      /прилук/iu,
      /ніжин/iu,
      /бахмач/iu,
      /новгород-сіверськ/iu,
      /корсунь/iu,
      /чернігівобленерго/iu,
    ],
  },
  {
    cpu: 'kiivska-oblast',
    patterns: [
      /київщин/iu,
      /київськ[а-яіїєґ]*\s+област/iu,
      /київська\s+обл/iu,
      /біл[а-яіїєґ]*\s+церкв/iu,
      /бровар/iu,
      /ірпін/iu,
      /бориспіл/iu,
      /буч[а-яіїєґ]*/iu,
      /фастів/iu,
      /вишгород/iu,
      /обухів/iu,
    ],
  },
  {
    cpu: 'kyiv',
    patterns: [
      /(?<=^|[^\p{L}])ки[єе]в[а-яіїєґ]*(?=$|[^\p{L}])/iu,
      /столиц/iu,
      /київські\s+електромережі/iu,
    ],
    // Якщо явно згадується Київщина або Київська область — це область, а не місто
    negativePatterns: [
      /київщин/iu,
      /київськ[а-яіїєґ]*\s+област/iu,
      /київська\s+обл/iu,
    ],
  },
  {
    cpu: 'lvivska-oblast',
    patterns: [
      /львівськ/iu,
      /львівщин/iu,
      /(?<=^|[^\p{L}])львів(?=$|[^\p{L}])/iu,
      /дрогобич/iu,
      /стрий/iu,
      /червоноград/iu,
      /самбір/iu,
      /львівобленерго/iu,
    ],
  },
  {
    cpu: 'dnipro-dnem',
    patterns: [
      /дніпропетровськ/iu,
      /дніпропетровщин/iu,
      /(?<=^|[^\p{L}])дніпр(о|і|а)(?=$|[^\p{L}])/iu,
      /крив[а-яіїєґ]*\s+р(іг|озі|огу)/iu,
      /кам'янськ|кам’янськ/iu,
      /нікопол/iu,
      /павлоград/iu,
    ],
  },
  {
    cpu: 'poltavska-oblast',
    patterns: [
      /полтавськ/iu,
      /полтавщин/iu,
      /(?<=^|[^\p{L}])полтав[а-яіїєґ]*(?=$|[^\p{L}])/iu,
      /кременчук/iu,
      /лубн/iu,
      /миргород/iu,
    ],
  },
  {
    cpu: 'cherkaska-oblast',
    patterns: [
      /черкаськ/iu,
      /(?<=^|[^\p{L}])черкас[а-яіїєґ]*(?=$|[^\p{L}])/iu,
      /черкащин/iu,
      /умань/iu,
      /сміл/iu,
    ],
  },
  {
    cpu: 'kharkivska-oblast',
    patterns: [
      /харківськ/iu,
      /харківщин/iu,
      /(?<=^|[^\p{L}])харків(?=$|[^\p{L}])/iu,
      /чугуїв/iu,
      /ізюм/iu,
      /куп'янськ|куп’янськ/iu,
    ],
  },
  {
    cpu: 'khmelnytska-oblast',
    patterns: [
      /хмельницьк/iu,
      /хмельниччин/iu,
      /кам'янець-подільськ|кам’янець-подільськ/iu,
      /шепетівк/iu,
    ],
  },
  {
    cpu: 'ivano-frankivska-oblast',
    patterns: [
      /івано-франківськ/iu,
      /прикарпатт/iu,
      /калуш/iu,
      /коломи/iu,
    ],
  },
  {
    cpu: 'rivnenska-oblast',
    patterns: [
      /рівненськ/iu,
      /рівненщин/iu,
      /(?<=^|[^\p{L}])рівн(е|о|ому)(?=$|[^\p{L}])/iu,
      /дубн/iu,
      /варош/iu,
    ],
  },
  {
    cpu: 'ternopilska-oblast',
    patterns: [
      /тернопільськ/iu,
      /тернопільщин/iu,
      /(?<=^|[^\p{L}])тернопіль(?=$|[^\p{L}])/iu,
      /кременець/iu,
    ],
  },
  {
    cpu: 'zakarpatska-oblast',
    patterns: [
      /закарпатськ/iu,
      /закарпатт/iu,
      /ужгород/iu,
      /мукачев/iu,
    ],
  },
  {
    cpu: 'zaporizka-oblast',
    patterns: [
      /запорізьк/iu,
      /запоріжж/iu,
      /мелітопол/iu,
      /бердянськ/iu,
    ],
  },
  {
    cpu: 'zhytomyrska-oblast',
    patterns: [
      /житомирськ/iu,
      /житомирщин/iu,
      /(?<=^|[^\p{L}])житомир(?=$|[^\p{L}])/iu,
      /бердичів/iu,
      /коростень/iu,
    ],
  },
];

const UKRAINE_WIDE_PATTERNS = [
  /в\s+(усіх|всіх)\s+областях/iu,
  /в\s+(усіх|всіх)\s+регіонах/iu,
  /по\s+всій\s+(україні|території)/iu,
  /по\s+всій\s+країні/iu,
  /енергосистем[а-яіїєґ]*\s+україни/iu,
  /ситуація\s+в\s+енергосистемі/iu,
  /споживання\s+в\s+україні/iu,
  /нек\s+["«]?укренерго["»]?/iu,
  /укренерго/iu,
  /по\s+україні/iu,
  /в\s+енергосистемі/iu,
];

/**
 * Визначає, чи новина стосується всієї України.
 */
export function isUkraineWideNews(text: string, defaultRegion?: string | null): boolean {
  if (!text) return false;
  for (const pattern of UKRAINE_WIDE_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

/**
 * Визначає region_cpu за текстом (заголовок + тіло).
 */
export function detectRegionCpu(text: string, fallbackRegion?: string | null): string | null {
  if (!text) return fallbackRegion ?? null;

  for (const rule of REGION_RULES) {
    if (rule.negativePatterns && rule.negativePatterns.some((np) => np.test(text))) {
      continue;
    }
    if (rule.patterns.some((p) => p.test(text))) {
      return rule.cpu;
    }
  }

  return fallbackRegion ?? null;
}

/**
 * Визначає категорію (kind) новини за ключовими словами.
 */
export function detectNewsKind(text: string): NewsKind {
  if (!text) return 'other';

  // 1. Аварійні та обстріли (найвищий пріоритет)
  if (
    /аварійн|екстрен|обстріл|ракет|шахед|дрон|приліт|влучанн|удар/iu.test(text)
  ) {
    return 'emergency';
  }

  // 2. Зміни графіків ГПВ
  if (
    /графік|гпв|гав|черг[а-яіїєґ]*\s+відключен|підчерг|розклад/iu.test(text)
  ) {
    return 'schedule-change';
  }

  // 3. Ремонтні роботи
  if (
    /ремонт|відновлювальн|ліквідаці[а-яіїєґ]*\s+пошкоджень|планові\s+роботи/iu.test(text)
  ) {
    return 'repair';
  }

  // 4. Загальні відключення
  if (
    /відключен|вимкнен|знеструмлен|без\s+світла|блекаут/iu.test(text)
  ) {
    return 'outage';
  }

  // 5. Енергосистема загалом
  if (
    /енергосистем|дефіцит|генераці|споживанн|імпорт[а-яіїєґ]*\s+електроенергії|тес|гес|аес/iu.test(text)
  ) {
    return 'ukraine';
  }

  return 'other';
}

/**
 * Генерує список тематичних тегів за текстом.
 */
export function extractNewsTags(text: string, regionCpu: string | null, kind: NewsKind): string[] {
  const tags = new Set<string>();

  if (kind !== 'other') {
    tags.add(kind);
  }

  if (regionCpu) {
    tags.add(regionCpu);
  }

  if (/графік|гпв/iu.test(text)) tags.add('графік');
  if (/аварійн/iu.test(text)) tags.add('аварія');
  if (/обстріл/iu.test(text)) tags.add('обстріл');
  if (/укренерго/iu.test(text)) tags.add('укренерго');
  if (/дтек/iu.test(text)) tags.add('дтек');
  if (/чернігівобленерго/iu.test(text)) tags.add('чернігівобленерго');

  return Array.from(tags);
}
