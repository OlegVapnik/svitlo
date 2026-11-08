/**
 * Надійність електропостачання: скільки хвилин без світла впало в задане вікно.
 *
 * Чиста арифметика над інтервалами, без SQL і без знання про D1. Раніше жила в
 * `cf-worker/src/index.ts` поруч із запитами до бази, тому її не можна було ні перевірити окремо,
 * ні використати в іншому місці.
 *
 * Два правила, які легко зламати:
 *  - перетини не рахуються двічі (`22:00–01:00` + `00:00–02:00` — це три години, а не пʼять);
 *  - межі вікна обрізають слот: інакше вчорашній слот цілком потрапляв би в сьогоднішній бакет.
 */

/** Інтервал у мілісекундах UTC. */
export interface MsInterval {
  startMs: number;
  endMs: number;
}

/**
 * Сума хвилин без світла всередині `[fromMs, toMs)` і кількість слотів, що туди потрапили.
 *
 * `slots` мусять бути відсортовані за `startMs` (це робить читач бази).
 */
export function unionMinutesInWindow(
  slots: readonly MsInterval[],
  fromMs: number,
  toMs: number,
): { minutes: number; count: number } {
  let total = 0;
  let count = 0;
  let cursor = fromMs;

  for (const slot of slots) {
    const start = Math.max(slot.startMs, fromMs, cursor);
    const end = Math.min(slot.endMs, toMs);
    if (end > start) {
      total += end - start;
      count += 1;
      cursor = end;
    }
  }

  return { minutes: Math.round(total / 60_000), count };
}
