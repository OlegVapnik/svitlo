/**
 * Витягує з довільного тексту (Telegram-повідомлення, новини, причина з даних оператора)
 * місце, причину та орієнтовний час події.
 *
 * Мета — на сторінці «Аварії» показати ДЕ і ЧОМУ зникло світло, а не лише сирий текст
 * повідомлення. Працює як для Чернігівської, так і для Сумської області.
 */

export interface IncidentDetails {
  /** Населений пункт / область, де сталася подія. */
  area: string | null;
  /** Стисла причина: обстріл, пошкодження мережі, ремонтні роботи тощо. */
  cause: string | null;
  /** Орієнтовний проміжок часу з тексту, напр. «14:30 – 18:00». */
  timeRange: string | null;
}

/** Області та неформальні назви регіонів (перевіряються першими). */
const OBLAST_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'Чернігівська область', re: /чернігівськ\p{L}*\s+област\p{L}*|чернігівщин\p{L}*/iu },
  { name: 'Сумська область', re: /сумськ\p{L}*\s+област\p{L}*|сумщин\p{L}*/iu },
  { name: 'Київська область', re: /київськ\p{L}*\s+област\p{L}*|київщин\p{L}*/iu },
];

/** Помітні населені пункти Чернігівщини та Сумщини (від довших назв до коротших). */
const PLACE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'Новгород-Сіверський', re: /новгород[\s-]сіверськ\p{L}*/iu },
  { name: 'Деснянське', re: /деснянськ\p{L}*/iu },
  { name: 'Чернігів', re: /чернігов\p{L}*/iu },
  { name: 'Ніжин', re: /ніжин\p{L}*/iu },
  { name: 'Прилуки', re: /прилук\p{L}*/iu },
  { name: 'Бахмач', re: /бахмач\p{L}*/iu },
  { name: 'Борзна', re: /борзн\p{L}*/iu },
  { name: 'Городня', re: /городн\p{L}*/iu },
  { name: 'Корюківка', re: /корюківк\p{L}*/iu },
  { name: 'Мена', re: /(?:^|[\s,;(])мен[аиу]\b/iu },
  { name: 'Сновськ', re: /сновськ\p{L}*/iu },
  { name: 'Сосниця', re: /сосниц\p{L}*/iu },
  { name: 'Ічня', re: /ічн\p{L}*/iu },
  { name: 'Козелець', re: /козельц\p{L}*/iu },
  { name: 'Ріпки', re: /ріпк\p{L}*/iu },
  { name: 'Куликівка', re: /куликівк\p{L}*/iu },
  { name: 'Конотоп', re: /конотоп\p{L}*/iu },
  { name: 'Шостка', re: /шостк\p{L}*/iu },
  { name: 'Охтирка', re: /охтирк\p{L}*/iu },
  { name: 'Ромни', re: /ромн\p{L}*/iu },
  { name: 'Тростянець', re: /тростянец\p{L}|тростянц\p{L}*/iu },
  { name: 'Лебедин', re: /лебедин\p{L}*/iu },
  { name: 'Суми', re: /(?:^|[\s,;(])сум[иах]\b/iu },
];

/** Причини (порядок важливий: спершу найважче/конкретніше). */
const CAUSE_PATTERNS: Array<{ cause: string; re: RegExp }> = [
  { cause: 'Обстріл / бойові дії', re: /обстріл\p{L}*|артобстріл\p{L}*|б[іо]йов\p{L}*\s+ді|ворож\p{L}*\s+(?:атак|обстріл)|ракет\p{L}*|шахед|бпла|дрон|керован\p{L}*\s+бомб|влучанн\p{L}*|внаслідок\s+атаки/iu },
  { cause: 'Пошкодження мережі', re: /пошкоджен\p{L}*|ушкоджен\p{L}*|обрив\p{L}*|розрив\p{L}*|замиканн\p{L}*|обірван\p{L}*\s+дрот/iu },
  { cause: 'Аварія на обладнанні', re: /аварі\p{L}*|спрацював\s+захист|вихід\s+з\s+ладу|перегор\p{L}*|згорів\p{L}*|несправн\p{L}*|пошкодженн\p{L}*\s+(?:тп|ктп|пс|рп)/iu },
  { cause: 'Ремонтні роботи', re: /ремонтн\p{L}*|технічн\p{L}*.{0,20}обслугов|планов\p{L}*.{0,20}робіт|замін\p{L}*.{0,20}(?:опор|обладнанн)|реконструкц\p{L}*|модернізац\p{L}*|розчистк\p{L}*/iu },
  { cause: 'Негода', re: /негод\p{L}*|гроз\p{L}*|бурев\p{L}*|шквал\p{L}*|сильн\p{L}*.{0,12}вітер|ожелед\p{L}*|снігопад\p{L}*|дощ\p{L}*\s+з\s+вітром|злив\p{L}*/iu },
  { cause: 'Перевантаження мережі', re: /перевантаж\p{L}*|дефіцит\s+потужност|обмеження\s+споживан|графік\p{L}*\s+погодинн|гпв/iu },
];

/** Орієнтовний час із тексту: «з 14:30 до 18:00», «14:30–18:00», «до 20:00». */
const TIME_RANGE = /(?:з\s+)?(\d{1,2}[:.]\d{2})\s*(?:-|–|—|до|по)\s*(\d{1,2}[:.]\d{2})/u;

const GENERIC_PLACE = /(?:^|[\s,;.(])(?:м\.|с\.|смт|селище|село|місто)\s*([А-ЯІЇЄҐ][\p{L}'’\-]+(?:\s+[А-ЯІЇЄҐ][\p{L}'’\-]+)?)/u;

/** Знаходить першу згадку в тексті серед списку патернів за позицією. */
function firstMatch(text: string, patterns: Array<{ name: string; re: RegExp }>): string | null {
  let best: { name: string; at: number } | null = null;
  for (const pattern of patterns) {
    const at = text.search(pattern.re);
    if (at === -1) continue;
    if (!best || at < best.at) best = { name: pattern.name, at };
  }
  return best?.name ?? null;
}

/** Витягує населений пункт/область; для необласних назв додає «обл.» для ясності. */
export function extractIncidentArea(text: string): string | null {
  if (!text) return null;
  const oblast = firstMatch(text, OBLAST_PATTERNS);
  const place = firstMatch(text, PLACE_PATTERNS);
  if (oblast && (place === null || text.search(OBLAST_PATTERNS.find((item) => item.name === oblast)!.re) <= text.search(PLACE_PATTERNS.find((item) => item.name === place)!.re))) {
    return oblast;
  }
  if (place) return place;
  if (oblast) return oblast;
  const generic = text.match(GENERIC_PLACE)?.[1]?.trim();
  return generic ?? null;
}

/** Витягує стислу причину події. */
export function extractIncidentCause(text: string): string | null {
  if (!text) return null;
  for (const pattern of CAUSE_PATTERNS) {
    if (pattern.re.test(text)) return pattern.cause;
  }
  return null;
}

/** Витягує орієнтовний проміжок часу з тексту. */
export function extractIncidentTimeRange(text: string): string | null {
  if (!text) return null;
  const match = text.match(TIME_RANGE);
  if (!match) return null;
  return `${match[1]!.replace('.', ':')} – ${match[2]!.replace('.', ':')}`;
}

export function extractIncidentDetails(text: string): IncidentDetails {
  return {
    area: extractIncidentArea(text),
    cause: extractIncidentCause(text),
    timeRange: extractIncidentTimeRange(text),
  };
}
