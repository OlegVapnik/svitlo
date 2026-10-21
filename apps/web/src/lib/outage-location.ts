export type MapPoint = { lat: number; lng: number; label: string };

// Approximate town/village points in Chernihiv Oblast. Desnianske is a village
// in Novhorod-Siverskyi Raion, not the city of Chernihiv.
const AREA_COORDINATES: Record<string, MapPoint> = {
  'Чернігів': { lat: 51.4982, lng: 31.2893, label: 'Чернігів' },
  'Чернігівський район': { lat: 51.4, lng: 31.2, label: 'Чернігівський район (центр району)' },
  'Деснянське': { lat: 51.8, lng: 32.9, label: 'с. Деснянське, Чернігівська область' },
  'Ніжин': { lat: 51.0487, lng: 31.8828, label: 'Ніжин' },
  'Ніжинський район': { lat: 51.05, lng: 31.88, label: 'Ніжинський район (центр району)' },
  'Прилуки': { lat: 50.5878, lng: 32.3872, label: 'Прилуки' },
  'Прилуцький район': { lat: 50.59, lng: 32.39, label: 'Прилуцький район (центр району)' },
  'Бахмач': { lat: 51.1822, lng: 32.8258, label: 'Бахмач' },
  'Борзна': { lat: 51.2522, lng: 32.4278, label: 'Борзна' },
  'Городня': { lat: 51.8928, lng: 31.5978, label: 'Городня' },
  'Корюківка': { lat: 51.7739, lng: 32.2539, label: 'Корюківка' },
  'Мена': { lat: 51.5222, lng: 32.2158, label: 'Мена' },
  'Новгород-Сіверський': { lat: 52.0089, lng: 33.2728, label: 'Новгород-Сіверський' },
  'Сновськ': { lat: 51.8172, lng: 31.9578, label: 'Сновськ' },
  'Сосниця': { lat: 51.5289, lng: 32.5028, label: 'Сосниця' },
  'Ічня': { lat: 50.8556, lng: 32.3789, label: 'Ічня' },
  'Козелець': { lat: 50.9167, lng: 31.1167, label: 'Козелець' },
  'Ріпки': { lat: 51.8014, lng: 31.0833, label: 'Ріпки' },
  'Куликівка': { lat: 51.3714, lng: 31.6444, label: 'Куликівка' },
};

const DEFAULT_POINT: MapPoint = { lat: 51.5, lng: 32.1, label: 'Чернігівська область (точне місце не визначено)' };

export function resolveOutageMapPoint(areaName: string, addresses = ''): MapPoint {
  const text = `${areaName} ${addresses}`.toLocaleLowerCase('uk-UA');
  if (text.includes('деснянське')) return AREA_COORDINATES['Деснянське']!;
  const direct = AREA_COORDINATES[areaName];
  if (direct) return direct;
  const districtName = areaName.replace(/ район$/iu, 'ський');
  return AREA_COORDINATES[districtName] ?? DEFAULT_POINT;
}

export function outageCategory(reason: string | null | undefined): 'incident' | 'planned' {
  return /виконання ремонтних робіт|ремонтн.{0,30}робіт|технічн.{0,30}обслугов/iu.test(reason ?? '')
    ? 'incident'
    : 'planned';
}
