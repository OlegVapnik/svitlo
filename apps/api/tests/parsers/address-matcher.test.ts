import { describe, expect, test } from 'vitest';
import { normalizeAddressQuery, rankAddressCandidate } from '../../src/parsers/address-matcher.js';

describe('address normalization and ranking', () => {
  test('normalizes street prefixes, case, and apostrophes', () => {
    expect(normalizeAddressQuery("ВУЛ. Деснянська ’вул." )).toBe("деснянська 'вул");
  });

  test.each(['десня', 'деснянська', 'десняская', 'Десн'])('ranks matching street for query %s', (query) => {
    const rank = rankAddressCandidate(query, { nameUk: 'Деснянська вул.', nameRu: 'Деснянская ул.' });
    expect(rank).toBeGreaterThan(0);
  });

  test('ranks exact prefix above an infix match', () => {
    expect(rankAddressCandidate('десня', { nameUk: 'Деснянське' }))
      .toBeGreaterThan(rankAddressCandidate('есня', { nameUk: 'вулиця Деснянська' }));
  });
});
