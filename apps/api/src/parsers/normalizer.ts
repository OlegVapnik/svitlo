export function normalizeAddress(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/вулиця/gi, 'вул.')
    .replace(/провулок/gi, 'пров.')
    .replace(/бульвар/gi, 'б-р')
    .replace(/проспект/gi, 'просп.');
}

export function normalizeAreaName(raw: string): string {
  const normalized = raw.trim().replace(/\s+/gu, ' ');
  const key = normalized.toLocaleLowerCase('uk-UA');
  const map: Record<string, string> = {
    'чернігівський': 'Чернігівський район',
    'ніжинський': 'Ніжинський район',
    'прилуцький': 'Прилуцький район',
  };
  return map[key] ?? normalized;
}

/** Розпізнає поселення в адресу-подібному рядку та не підміняє його назвою району. */
export function normalizeOutageLocation(areaName: string, addressesRaw: string): string {
  const place = `${areaName} ${addressesRaw}`;
  if (/деснянське/iu.test(place)) return 'Деснянське';
  if (/чернігівська область/iu.test(areaName) && addressesRaw.trim()) {
    return /деснянське/iu.test(addressesRaw) ? 'Деснянське' : addressesRaw.match(/(?:^|[,;])\s*с\.\s*([^,;]+)/iu)?.[1]?.trim() ?? 'Чернігівська область';
  }
  const villageInAddress = addressesRaw.match(/(?:^|[,;])\s*с\.\s*([^,;]+)/iu)?.[1]?.trim();
  if (villageInAddress) return villageInAddress;
  return normalizeAreaName(areaName);
}

export function parseDateRange(text: string, timezone: string): { start: Date; end: Date } | null {
  // Mock parser for demo
  const now = new Date();
  return { start: now, end: new Date(now.getTime() + 4 * 3600000) };
}
