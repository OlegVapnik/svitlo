/**
 * Чисті правила типографіки (без React Native) — щоб їх можна було перевіряти
 * у Node-тестах і використовувати і в `<Text>`, і в майбутніх компонентах.
 *
 * Причина існування: на Android `fontWeight` не завжди має реальне накреслення.
 * Системний шрифт (MiSans у HyperOS, Roboto в AOSP без medium) синтезує жир
 * (`fakeBold`), і синтетичні гліфи ширші за метрики, якими Yoga міряє рядок.
 * Тому вага перетворюється на конкретну родину з `assets/fonts` — вимір і рендер
 * використовують один файл шрифту.
 */

export const FAMILY_BY_WEIGHT: Record<string, string> = {
  '100': 'Inter-Regular',
  '200': 'Inter-Regular',
  '300': 'Inter-Regular',
  '400': 'Inter-Regular',
  '500': 'Inter-Medium',
  '600': 'Inter-SemiBold',
  '700': 'Inter-Bold',
  '800': 'Inter-ExtraBold',
  '900': 'Inter-ExtraBold',
};

export const WEIGHT_BY_CLASS: Record<string, string> = {
  thin: '100',
  extralight: '200',
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
};

const WEIGHT_CLASS_SOURCE =
  '\\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\\b';

/** Вага з класів Tailwind (`font-semibold` → `600`). */
export function weightFromClassName(className?: string | null): string | undefined {
  if (!className) return undefined;
  const match = new RegExp(WEIGHT_CLASS_SOURCE).exec(className);
  return match ? WEIGHT_BY_CLASS[match[1]] : undefined;
}

/** Нормалізує `fontWeight` у числовий рядок (`bold` → `700`, `normal` → `400`). */
export function normalizeWeight(
  value?: string | number | null,
  fallback = '400',
): string {
  if (value == null) return fallback;
  if (value === 'normal') return '400';
  if (value === 'bold') return '700';
  const key = String(value);
  return FAMILY_BY_WEIGHT[key] ? key : fallback;
}

/** Родина шрифту для ваги. */
export function familyForWeight(weight: string): string {
  return FAMILY_BY_WEIGHT[weight] ?? FAMILY_BY_WEIGHT['400'];
}

/**
 * Прибирає з `className` вагові класи: інакше вони виставлять `fontWeight` поверх
 * уже вибраної реальної родини й повернуть синтетичний жир.
 */
export function stripWeightClasses(className?: string | null): string | undefined {
  if (!className) return className ?? undefined;
  return className
    .replace(new RegExp(WEIGHT_CLASS_SOURCE, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Підсумкові параметри тексту: родина, вага та очищений className. */
export function resolveTypography(input: {
  className?: string | null;
  fontWeight?: string | number | null;
  fontFamily?: string | null;
}): { fontFamily: string; weight: string; className?: string } {
  const weight = normalizeWeight(input.fontWeight, weightFromClassName(input.className) ?? '400');
  return {
    weight,
    fontFamily: input.fontFamily ?? familyForWeight(weight),
    className: stripWeightClasses(input.className),
  };
}
