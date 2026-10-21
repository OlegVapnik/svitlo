const STREET_PREFIXES = /^(?:(?:вулиця|вул|улица|ул|проспект|просп|провулок|пров|переулок|пер)\.?\s+)+/iu;
const CHAR_MAP: Record<string, string> = {
  ё: 'е', ы: 'и', э: 'е', ї: 'і', '’': "'", 'ʼ': "'", '`': "'", '‘': "'", '´': "'",
};

export function normalizeAddressQuery(value: string): string {
  let normalized = value.normalize('NFKC').toLocaleLowerCase('uk-UA');
  normalized = normalized.replace(/[ёыэї]/gu, (char) => CHAR_MAP[char] ?? char);
  normalized = normalized.replace(/[’ʼ`‘´]/gu, "'");
  normalized = normalized.replace(/[.,;:()[\]{}]/gu, " ");
  normalized = normalized.replace(STREET_PREFIXES, '');
  return normalized.replace(/\s+/gu, ' ').trim();
}

export function transliterationVariants(value: string): string[] {
  const normalized = normalizeAddressQuery(value);
  const variants = new Set([normalized]);
  const ru = normalized.replace(/[иі]/gu, 'и');
  const uk = normalized.replace(/[иі]/gu, 'і');
  variants.add(ru);
  variants.add(uk);
  return [...variants].filter(Boolean);
}

export type AddressCandidate = {
  nameUk: string;
  nameRu?: string | null;
  nameNormalized?: string;
};

export function rankAddressCandidate(query: string, candidate: AddressCandidate): number {
  const qVariants = transliterationVariants(query);
  const names = [candidate.nameUk, candidate.nameRu ?? '', candidate.nameNormalized ?? '']
    .map(normalizeAddressQuery)
    .filter(Boolean);
  let best = 0;
  for (const q of qVariants) {
    for (const name of names) {
      if (name === q) best = Math.max(best, 100);
      else if (name.startsWith(q)) best = Math.max(best, 90);
      else if (name.split(/\s+/u).some((word) => word.startsWith(q))) best = Math.max(best, 80);
      else if (name.includes(q)) best = Math.max(best, 70);
      else if (q.length >= 4 && name.length >= 4 && q.slice(0, 4) === name.slice(0, 4)) best = Math.max(best, 60);
      else if (q.length >= 3 && name.includes(q)) best = Math.max(best, 65);
    }
  }
  return best;
}
