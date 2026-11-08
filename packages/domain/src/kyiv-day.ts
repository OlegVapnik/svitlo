/**
 * Межі київської доби як моменти UTC.
 *
 * Навіщо окремо від `kyiv-time.ts`: там «дата за Києвом» і перерахунок місцевого часу
 * в UTC, а тут — саме *інтервал* доби, потрібний, щоб відповісти «ця подія стосується
 * обраного дня?». Раніше ця логіка жила в клієнтському `packages/core` на
 * `Intl.DateTimeFormat(... timeZoneName: 'shortOffset')`.
 *
 * У ніч переходу на зимовий час київська доба триває 25 годин, у ніч переходу на
 * літній — 23. Тому кінець доби рахується як *місцева* північ наступної дати, а не як
 * `початок + 24 год`: інакше остання (або зайва) година доби випадає з фільтра.
 */

import { kyivDateKeyFromMs, kyivWallClockMs, shiftYmd } from './kyiv-time.ts';

function midnightMsOf(ymd: string): number {
  return kyivWallClockMs(ymd, '00:00', false);
}

/** Початок київської доби, у яку потрапляє `date`. */
export function kyivDayStart(date: Date): Date {
  return new Date(midnightMsOf(kyivDateKeyFromMs(date.getTime())));
}

/** Початок наступної київської доби після тієї, у яку потрапляє `date`. */
export function kyivNextDayStart(date: Date): Date {
  const ymd = kyivDateKeyFromMs(date.getTime());
  return new Date(midnightMsOf(shiftYmd(ymd, 1)));
}

/**
 * Чи перетинається інтервал `[startsAt, endsAt]` з київською добою `day`.
 *
 * Межі початку доби включні зліва (подія, що почалася рівно о 00:00, належить добі), а
 * кінець доби — ні (подія, що почалася рівно о 00:00 наступної доби, до попередньої вже
 * не належить).
 */
export function outageOverlapsKyivDay(startsAt: string, endsAt: string, day: Date): boolean {
  const from = kyivDayStart(day).getTime();
  const to = kyivNextDayStart(day).getTime();
  return Date.parse(startsAt) < to && Date.parse(endsAt) >= from;
}
