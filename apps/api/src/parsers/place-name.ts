/**
 * Чисті помічники для назв населених пунктів у даних операторів.
 *
 * Навіщо окремий модуль: раніше в коді був «прибитий» один населений пункт (`Деснянське`) — і в
 * нормалізаторі, і в адаптері. Це давало правильну назву для одного села й хибну для решти
 * (напр. «ДЕСНЯНСЬКЕ» — це село Коропського району, а «Деснянський район» — район у Чернігові).
 * Тепер правило одне, загальне й тестоване.
 */

/**
 * «ДЕСНЯНСЬКЕ» → «Деснянське», «НОВГОРОД-СІВЕРСЬКИЙ» → «Новгород-Сіверський»,
 * «нова басань» → «Нова Басань». Назву у змішаному регістрі лишаємо як є — джерело
 * вже написало її так, як треба (не переписуємо «Лубʼяни» у «ЛубʼЯни»).
 */
export function titleCasePlace(raw: string): string {
  const value = raw.trim().replace(/\s+/gu, ' ');
  if (!value) return '';
  const isUpper = value.toLocaleUpperCase('uk-UA') === value;
  const isLower = value.toLocaleLowerCase('uk-UA') === value;
  if (!isUpper && !isLower) return value;
  return value
    .toLocaleLowerCase('uk-UA')
    .replace(/(^|[\s\-'(’ʼ])(\p{L})/gu, (_match, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('uk-UA'));
}

/** Префікси населених пунктів в адресах оператора: «с. X», «смт X», «м. X», «село X», «селище X». */
const SETTLEMENT_PREFIX = '(?:с|смт|м|село|селище|села|селища)';
/**
 * «Деснянський район» — це район, а не населений пункт: такий збіг НЕ можна повертати як село.
 * Так само не повертаємо область.
 */
const NOT_A_SETTLEMENT = /(район|област|громад|старост)/iu;

/**
 * Витягує назву населеного пункту з адресного рядка/поля оператора.
 * Повертає null, якщо в рядку населеного пункту немає (це район/область/вулиця).
 */
export function extractSettlementName(value: string): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  // 1) Явний префікс: «с. Новгород-Сіверський», «смт Короп», «м. Чернігів».
  const prefixed = text.match(new RegExp(`(?:^|[,;])\\s*${SETTLEMENT_PREFIX}\\.?\\s+([^,;]+)`, 'iu'))?.[1]?.trim();
  if (prefixed && !NOT_A_SETTLEMENT.test(prefixed)) return titleCasePlace(prefixed);
  // 2) Оператор часто віддає саме назву пункту в полі "місце" («ДЕСНЯНСЬКЕ») без префікса:
  //    беремо її лише тоді, коли це не район/область і не схоже на вулицю.
  if (!NOT_A_SETTLEMENT.test(text) && !/(вул\.|вулиця|пров\.|просп\.|бульв\.)/iu.test(text) && text.length <= 60) {
    return titleCasePlace(text);
  }
  return null;
}
