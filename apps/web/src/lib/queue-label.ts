/**
 * Подпись группы по региону.
 *
 * В Киеве и у ДТЕК оператор называет её «група» (иногда просто числом — 35), у остальных
 * облэнерго — «черга» (2/2). Это не косметика: человек ищет в квитанции ровно то слово,
 * которое напечатал его оператор.
 */
const DTEK_REGIONS = new Set([
  'kyiv-city',
  'kyivska-oblast',
  'dnipropetrovska-oblast',
  'dnipro-cek',
  'dnipro-dnem',
  'odeska-oblast',
  'donetska-oblast',
]);

export function isDtekRegion(regionCpu: string | null | undefined): boolean {
  return DTEK_REGIONS.has(String(regionCpu ?? '').trim());
}

/** «Група 35» для Киева/ДТЕК, «Черга 2/2» для облэнерго. */
export function formatQueueLabel(queue: string, regionCpu?: string | null): string {
  const code = String(queue ?? '').trim();
  if (!isDtekRegion(regionCpu)) return `Черга ${code}`;
  // У Києві джерело нумерує групи 1/1…60/1: для людини це «група 35», а не «35/1».
  // Значение в API залишається 35/1 — підпис змінюється лише для показу.
  const kyivGroup = /^(\d+)\/1$/u.exec(code);
  if (kyivGroup && (regionCpu === 'kyiv-city' || regionCpu === 'kyivska-oblast')) {
    return `Група ${kyivGroup[1]}`;
  }
  return `Група ${code}`;
}
