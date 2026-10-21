import { db } from '../db/connection.js';
import { addresses, outages } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { normalizeAddressQuery, transliterationVariants } from '../parsers/address-matcher.js';

export type AddressSuggestion = {
  id: string;
  type: 'district' | 'street' | 'settlement';
  name: string;
  subtitle: string;
  matchedText: string;
  nameUk: string;
  nameRu: string | null;
  city: string | null;
};

export async function suggestAddresses(query: string, limit = 8): Promise<AddressSuggestion[]> {
  const normalized = normalizeAddressQuery(query);
  const variants = transliterationVariants(query);
  // ВАЖНО: drizzle рендерит JS-массив как "(a, b)", а не как text[],
  // поэтому собираем Postgres-массив явно через sql.join(...).
  const variantTerms = sql.join(variants.map((variant) => sql`${variant}`), sql`, `);
  const rows = await db.execute(sql`
    WITH search_terms AS (
      SELECT unnest(ARRAY[${variantTerms}]::text[]) AS term
    ), scored AS (
      SELECT a.id, a.type, a.name_uk, a.name_ru, a.name_normalized, a.city,
        GREATEST(
          CASE WHEN energy_normalize_address(a.name_uk) = t.term THEN 100 ELSE 0 END,
          CASE WHEN energy_normalize_address(a.name_uk) LIKE t.term || '%' THEN 90 ELSE 0 END,
          CASE WHEN energy_normalize_address(a.name_uk) ~ ('(^|\\s)' || t.term) THEN 80 ELSE 0 END,
          similarity(a.name_normalized, t.term) * 70,
          similarity(energy_normalize_address(coalesce(a.name_ru, '')), t.term) * 70
        ) AS score,
        t.term
      FROM addresses a CROSS JOIN search_terms t
      WHERE a.name_normalized % t.term
        OR energy_normalize_address(a.name_uk) LIKE '%' || t.term || '%'
        OR energy_normalize_address(coalesce(a.name_ru, '')) LIKE '%' || t.term || '%'
    )
    SELECT id, type, name_uk, name_ru, city, max(score) AS score, (array_agg(term ORDER BY score DESC))[1] AS term
    FROM scored GROUP BY id, type, name_uk, name_ru, city
    ORDER BY score DESC, name_uk ASC
    LIMIT ${Math.max(1, Math.min(20, limit))}
  `);
  const suggestions = (rows as unknown as Array<Record<string, unknown>>).map((row) => {
    const nameUk = String(row['name_uk']);
    const nameRu = row['name_ru'] == null ? null : String(row['name_ru']);
    const city = row['city'] == null ? null : String(row['city']);
    const type = String(row['type']) as AddressSuggestion['type'];
    const matchedText = String(row['term'] ?? '');
    return {
      id: String(row['id']),
      type,
      name: nameUk,
      subtitle: [city, type === 'street' ? 'Вулиця' : type === 'district' ? 'Район' : 'Населений пункт'].filter(Boolean).join(' · '),
      matchedText: normalized,
      nameUk,
      nameRu,
      city,
    };
  });
  if (suggestions.length >= limit) return suggestions;

  const extraRows = await db.select({ id: addresses.id, type: addresses.type, nameUk: addresses.nameUk, nameRu: addresses.nameRu, city: addresses.city })
    .from(addresses).where(sql`${addresses.nameNormalized} LIKE ${`%${normalized}%`}`).limit(limit);
  const seen = new Set(suggestions.map((item) => item.nameUk.toLocaleLowerCase('uk-UA')));
  for (const item of extraRows) {
    if (seen.has(item.nameUk.toLocaleLowerCase('uk-UA'))) continue;
    seen.add(item.nameUk.toLocaleLowerCase('uk-UA'));
    suggestions.push({ id: item.id, type: item.type as AddressSuggestion['type'], name: item.nameUk, subtitle: [item.city, item.type === 'street' ? 'Вулиця' : item.type === 'district' ? 'Район' : 'Населений пункт'].filter(Boolean).join(' · '), matchedText: normalized, nameUk: item.nameUk, nameRu: item.nameRu, city: item.city });
  }
  if (suggestions.length < limit) {
    const outageRows = await db.select({ addressesRaw: outages.addressesRaw, areaName: outages.areaName }).from(outages)
      .where(sql`energy_normalize_address(${outages.addressesRaw}) LIKE ${`%${normalized}%`}`).limit(limit);
    for (const row of outageRows) {
      const candidate = row.addressesRaw.split(/[;,\\n]/u).map((part) => part.trim()).find((part) => normalizeAddressQuery(part).includes(normalized));
      if (!candidate || seen.has(candidate.toLocaleLowerCase('uk-UA'))) continue;
      seen.add(candidate.toLocaleLowerCase('uk-UA'));
      suggestions.push({ id: `outage:${candidate}`, type: 'street', name: candidate, subtitle: `${row.areaName} · Вулиця · з графіка відключень`, matchedText: normalized, nameUk: candidate, nameRu: null, city: row.areaName });
      if (suggestions.length >= limit) break;
    }
  }
  return suggestions.slice(0, limit);
}
