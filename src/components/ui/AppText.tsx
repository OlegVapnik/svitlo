import { forwardRef, type ComponentRef, type ReactElement } from 'react';
import {
  StyleSheet,
  Text as RNText,
  type TextProps,
} from 'react-native';

import { familyForWeight, resolveTypography } from '@/lib/typography';

/**
 * Єдиний текстовий примітив застосунку.
 *
 * Навіщо він потрібен (першопричини обрізання на Android):
 *
 * 1. `fontWeight: '500'…'900'` із системним шрифтом. Android підбирає накреслення
 *    з родини (MiSans, Roboto) або синтезує його (`fakeBold`). Синтетичний жир
 *    ширший за метрики, якими Yoga міряє рядок, тому остання літера виходила за
 *    межі власного боксу `<Text>`.
 *    Лікування: підключені реальні накреслення Inter (`assets/fonts`), а `fontWeight`
 *    перетворюється на конкретну `fontFamily` — вимір і рендер використовують один
 *    і той самий файл шрифту.
 *
 * 2. У React Native 0.88 `Text` має дефолтний стиль `overflow: 'hidden'`
 *    (`Libraries/Text/Text.js`). Через нього `ReactTextView` викликає
 *    `clipToPaddingBox` і ріже гліфи, що вилізли за виміряну ширину на частку
 *    пікселя — саме так зникали останні символи («Головн», «00:0», «Област»).
 *    Лікування: `overflow: 'visible'` — макет і переноси задає той самий
 *    `StaticLayout`, а останній гліф більше не обрізається боксом.
 *
 * 3. `includeFontPadding: true` додає до боксу вертикальні метрики шрифту, які на
 *    різних прошивках різні; у щільних рядках це зсуває базову лінію та збільшує
 *    висоту. Вимикаємо — висоту рядка задають `fontSize`/`lineHeight`.
 *
 * 4. `textBreakStrategy: 'simple'` для коротких підписів: `highQuality` вміє
 *    перебалансувати рядок і переносити слово там, де місця вистачає.
 *
 * Будь-який із цих дефолтів можна перекрити власним `style`/пропом.
 */
export const Text = forwardRef<ComponentRef<typeof RNText>, TextProps>(function AppText(
  { className, style, textBreakStrategy, ...rest },
  ref,
): ReactElement {
  const flat = (style == null ? undefined : StyleSheet.flatten(style)) ?? {};
  const { fontFamily, className: cleanedClassName } = resolveTypography({
    className,
    fontWeight: flat.fontWeight,
    fontFamily: flat.fontFamily,
  });

  const { fontWeight: _fontWeight, ...restStyle } = flat;

  return (
    <RNText
      ref={ref}
      className={cleanedClassName}
      textBreakStrategy={textBreakStrategy ?? 'simple'}
      style={[
        { fontFamily, includeFontPadding: false, overflow: 'visible' },
        restStyle,
        // Родина повторюється останньою: жоден клас чи вкладений стиль не поверне
        // синтетичне накреслення.
        { fontFamily: fontFamily ?? familyForWeight('400') },
      ]}
      {...rest}
    />
  );
});

export type AppTextProps = TextProps;
