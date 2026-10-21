/**
 * Приблизительные центры областей для карты отключений.
 *
 * Зачем: центр карты был жёстко зашит на Чернигов (`[51.5, 32.1]`), поэтому для любой другой
 * области карта открывалась в другом регионе страны — карта выглядела «сломанной».
 * Координаты — приблизительные центроиды областей (округлённые до 0.1°), этого достаточно,
 * чтобы карта показывала нужную область в правильном масштабе.
 *
 * Точных координат мы не выдумываем: это географический факт, а не данные об отключениях.
 */
export const REGION_CENTERS: Record<string, { center: [number, number]; zoom: number }> = {
  'chernihivska-oblast': { center: [51.3, 31.3], zoom: 8 },
  kyiv: { center: [50.45, 30.52], zoom: 11 },
  'kiivska-oblast': { center: [50.05, 30.35], zoom: 9 },
  'dnipro-dnem': { center: [48.46, 35.04], zoom: 11 },
  'dnipro-cek': { center: [48.5, 35.1], zoom: 9 },
  'dnipropetrovska-oblast': { center: [48.5, 35.4], zoom: 9 },
  'kharkivska-oblast': { center: [49.6, 36.2], zoom: 8 },
  'poltavska-oblast': { center: [49.6, 34.4], zoom: 8 },
  'cherkaska-oblast': { center: [49.1, 31.6], zoom: 8 },
  'lvivska-oblast': { center: [49.7, 23.9], zoom: 8 },
  'zhytomyrska-oblast': { center: [50.25, 28.65], zoom: 8 },
  'ternopilska-oblast': { center: [49.55, 25.6], zoom: 8 },
  'khmelnytska-oblast': { center: [49.3, 27.0], zoom: 8 },
  'rivnenska-oblast': { center: [50.65, 26.6], zoom: 8 },
  'volynska-oblast': { center: [50.75, 25.0], zoom: 8 },
  'zakarpatska-oblast': { center: [48.6, 22.2], zoom: 8 },
  'ivano-frankivska-oblast': { center: [48.9, 24.7], zoom: 8 },
  'zaporizka-oblast': { center: [47.8, 35.2], zoom: 8 },
  'mykolaivska-oblast': { center: [47.1, 31.9], zoom: 8 },
  'odeska-oblast': { center: [46.6, 30.9], zoom: 8 },
  'khersonska-oblast': { center: [46.6, 32.6], zoom: 8 },
  'donetska-oblast': { center: [48.0, 37.8], zoom: 8 },
  'luhanska-oblast': { center: [48.6, 39.3], zoom: 8 },
  'sumska-oblast': { center: [51.0, 34.1], zoom: 8 },
  'kirovohradska-oblast': { center: [48.5, 32.0], zoom: 8 },
  'sevastopol': { center: [44.6, 33.5], zoom: 10 },
};

/** Центр і масштаб для области; при неизвестной — Киев, чтобы карта не «улетела». */
export function regionCenter(region?: string): { center: [number, number]; zoom: number } {
  if (!region) return REGION_CENTERS.kyiv!;
  return REGION_CENTERS[region] ?? REGION_CENTERS.kyiv!;
}
