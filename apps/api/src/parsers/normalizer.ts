import { extractSettlementName } from './place-name.js';

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
  // 1) Найточніше джерело — сама адреса: «с. Деснянське, вул. Зарічна, 43».
  const fromAddress = extractSettlementName(addressesRaw);
  if (fromAddress) return fromAddress;
  // 2) Інакше — поле «місце» оператора («ДЕСНЯНСЬКЕ»), але район/область населеним пунктом не вважаємо.
  const fromArea = extractSettlementName(areaName);
  if (fromArea) return fromArea;
  if (/чернігівська область/iu.test(areaName) && addressesRaw.trim()) return 'Чернігівська область';
  return normalizeAreaName(areaName);
}

export function parseDateRange(text: string, timezone: string): { start: Date; end: Date } | null {
  // Mock parser for demo
  const now = new Date();
  return { start: now, end: new Date(now.getTime() + 4 * 3600000) };
}
