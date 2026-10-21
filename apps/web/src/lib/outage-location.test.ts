import { describe, expect, it } from 'vitest';
import { outageCategory, resolveOutageMapPoint } from './outage-location.js';

describe('outage location/category display helpers', () => {
  it('pins Desnianske separately from Chernihiv city', () => {
    const village = resolveOutageMapPoint('Деснянське', 'вул. Зарічна, 43');
    const city = resolveOutageMapPoint('Чернігів');
    expect(village.label).toContain('с. Деснянське');
    expect(village.lat).not.toBe(city.lat);
    expect(village.lng).not.toBe(city.lng);
  });

  it('classifies repair works as incident work but restriction schedules as planned', () => {
    expect(outageCategory('Виконання ремонтних робіт на обладнанні підстанції')).toBe('incident');
    expect(outageCategory('Заходи обмеження')).toBe('planned');
  });
});
