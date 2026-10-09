import { describe, expect, test } from 'vitest';
import { mergeDuplicateOutages, outageEventKey, streetFromAddresses, summarizeAffectedAddresses } from '../../src/services/outage-grouping.js';

const base = {
  startsAt: new Date('2026-10-09T15:30:00.000Z'),
  endsAt: new Date('2026-10-09T19:00:00.000Z'),
  areaName: 'ДЕСНЯНСЬКЕ',
  reason: 'Заходи обмеження (заплановані)',
};

describe('outage grouping по адресах', () => {
  test('згортає рядки, що відрізняються лише адресами, в одну подію', () => {
    const merged = mergeDuplicateOutages([
      { ...base, addressesRaw: 'вул. Шевченка 13, 14' },
      { ...base, addressesRaw: 'вул. Зарічна 43' },
      { ...base, addressesRaw: 'вул. Молодіжна 7' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.addressesRaw).toContain('вул. Шевченка');
    expect(merged[0]!.addressesRaw).toContain('вул. Зарічна');
    expect(merged[0]!.addressesRaw).toContain('вул. Молодіжна');
  });

  test('не згортає події з різним часом або причиною', () => {
    const merged = mergeDuplicateOutages([
      { ...base, addressesRaw: 'вул. Шевченка 13' },
      { ...base, endsAt: new Date('2026-10-09T20:00:00.000Z'), addressesRaw: 'вул. Шевченка 13' },
      { ...base, reason: 'Виконання ремонтних робіт', addressesRaw: 'вул. Шевченка 13' },
    ]);
    expect(merged).toHaveLength(3);
  });

  test('ключ події не залежить від адрес', () => {
    const a = outageEventKey({ ...base, addressesRaw: 'вул. A 1' });
    const b = outageEventKey({ ...base, addressesRaw: 'вул. B 2, 3, 4' });
    expect(a).toBe(b);
  });

  test('для однієї вулиці лишає номери будинків, для багатьох — згортає до назв', () => {
    expect(summarizeAffectedAddresses(['вул. Зарічна 19, 20, 43'])).toBe('вул. Зарічна 19, 20, 43');
    const many = summarizeAffectedAddresses(['вул. Шевченка 1', 'вул. Зарічна 2', 'вул. Молодіжна 3']);
    expect(many).toBe('вул. Шевченка, вул. Зарічна, вул. Молодіжна');
  });

  test('streetFromAddresses дістає назву вулиці або null', () => {
    expect(streetFromAddresses('ДЕСНЯНСЬКЕ, вул. Зарічна 43')).toBe('вул. Зарічна');
    expect(streetFromAddresses('ДЕСНЯНСЬКЕ')).toBeNull();
  });
});
