import { describe, expect, it } from 'vitest';
import {
  addSavedPlace,
  defaultPlaceLabel,
  ensurePrimary,
  findSavedPlaceFor,
  LEGACY_BOOKMARKS_KEY,
  MAX_PLACE_LABEL_LENGTH,
  MAX_SAVED_PLACES,
  migrateSavedPlaces,
  moveSavedPlace,
  readRawSavedPlaces,
  removeSavedPlace,
  renameSavedPlace,
  restoreSavedPlace,
  SAVED_PLACES_KEY,
  sanitizePlaceLabel,
  serializeSavedPlaces,
  setSavedPlaceIcon,
  setSavedPlacePrimary,
  setSavedPlaceQueue,
  type SavedPlace,
} from './saved-places.js';

class MockStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const place = (overrides: Partial<SavedPlace> = {}): SavedPlace => ({
  id: overrides.id ?? 'p1',
  label: overrides.label ?? 'Дім',
  icon: overrides.icon ?? 'home',
  regionCpu: overrides.regionCpu ?? 'kyiv-city',
  queue: overrides.queue ?? '1',
  ...overrides,
});

describe('sanitizePlaceLabel', () => {
  it('згортає пробіли, прибирає керуючі символи й обрізає до ліміту', () => {
    expect(sanitizePlaceLabel('  Дім   батьків \n')).toBe('Дім батьків');
    expect(sanitizePlaceLabel('a'.repeat(MAX_PLACE_LABEL_LENGTH + 10))).toHaveLength(
      MAX_PLACE_LABEL_LENGTH,
    );
    expect(sanitizePlaceLabel(42)).toBe('');
    expect(sanitizePlaceLabel('   ')).toBe('');
  });
});

describe('migrateSavedPlaces', () => {
  it('переносить старі закладки v1, скорочує довгі підписи й ставить іконку', () => {
    const migrated = migrateSavedPlaces([
      {
        id: 'legacy-1',
        label: 'Дім · Київ, Хрещатик 1',
        kind: 'home',
        regionCpu: 'kyiv-city',
        settlementName: 'Київ',
        streetName: 'Хрещатик',
        queue: '3',
        isPrimary: true,
      },
      {
        id: 'legacy-2',
        label: 'Робота · Львів, Площа Ринок 2',
        kind: 'work',
        regionCpu: 'lvivska-oblast',
        queue: '2/1',
      },
    ]);

    expect(migrated).toHaveLength(2);
    expect(migrated[0]).toMatchObject({
      id: 'legacy-1',
      label: 'Дім',
      icon: 'home',
      regionCpu: 'kyiv-city',
      queue: '3',
      isPrimary: true,
    });
    expect(migrated[1]).toMatchObject({ label: 'Робота', icon: 'work', queue: '2/1' });
  });

  it('приймає конверт v1 з bookmarks і конверт v2 з places', () => {
    const v1 = migrateSavedPlaces({
      schemaVersion: 1,
      bookmarks: [{ regionCpu: 'kyiv-city', queue: '1', label: 'Дім' }],
    });
    expect(v1).toHaveLength(1);

    const v2 = migrateSavedPlaces({
      schemaVersion: 2,
      places: [
        {
          id: 'p2',
          label: 'Дача',
          icon: 'dacha',
          regionCpu: 'kyivska-oblast',
          queue: '2/2',
          settlementName: 'Ірпінь',
        },
      ],
    });
    expect(v2[0]).toMatchObject({ label: 'Дача', icon: 'dacha', queue: '2/2' });
  });

  it('викидає биті записи: невідома область чи черга не стають місцем за замовчуванням', () => {
    const migrated = migrateSavedPlaces([
      { regionCpu: 'not a region!', queue: '1', label: 'Ніде' },
      { regionCpu: 'kyiv-city', queue: 'не-черга', label: 'Без черги' },
      null,
      'сміття',
      { regionCpu: 'kyiv-city', queue: '1', label: 'Справжнє' },
    ]);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]!.label).toBe('Справжнє');
  });

  it('схлопує дублікати за id та адресою і не перевищує ліміт', () => {
    const sameAddress = [
      { id: 'a', regionCpu: 'kyiv-city', queue: '1', label: 'Дім', settlementName: 'Київ' },
      { id: 'b', regionCpu: 'kyiv-city', queue: '2', label: 'Дім 2', settlementName: 'Київ' },
    ];
    expect(migrateSavedPlaces(sameAddress)).toHaveLength(1);

    const many = Array.from({ length: MAX_SAVED_PLACES + 3 }, (_, index) => ({
      id: `p${index}`,
      regionCpu: 'kyiv-city',
      queue: '1',
      label: `Місце ${index}`,
      settlementName: `Село ${index}`,
    }));
    expect(migrateSavedPlaces(many)).toHaveLength(MAX_SAVED_PLACES);
  });

  it('робить рівно одне місце головним навіть якщо у сховищі їх два', () => {
    const migrated = migrateSavedPlaces([
      { id: 'a', regionCpu: 'kyiv-city', queue: '1', label: 'A', isPrimary: true },
      { id: 'b', regionCpu: 'kyiv-city', queue: '1', label: 'B', streetName: 'Інша', isPrimary: true },
    ]);
    expect(migrated.filter((item) => item.isPrimary)).toHaveLength(1);
    expect(migrated[0]!.isPrimary).toBe(true);
  });
});

describe('addSavedPlace', () => {
  it('дає типову назву «Дім», а далі «Адреса 2»', () => {
    const first = addSavedPlace([], { regionCpu: 'kyiv-city', queue: '1' });
    expect(first.ok && first.place.label).toBe('Дім');
    expect(first.ok && first.place.icon).toBe('star');
    if (!first.ok) throw new Error('unreachable');

    const second = addSavedPlace(first.places, {
      regionCpu: 'kyiv-city',
      queue: '1',
      settlementName: 'Київ',
      streetName: 'Хрещатик',
    });
    expect(second.ok && second.place.label).toBe('Адреса 2');
    expect(defaultPlaceLabel(first.places)).toBe('Адреса 2');
  });

  it('відхиляє невідому область і некоректну чергу', () => {
    expect(addSavedPlace([], { regionCpu: 'not a region!', queue: '1' })).toMatchObject({
      ok: false,
      reason: 'invalid-region',
    });
    expect(addSavedPlace([], { regionCpu: '', queue: '1' })).toMatchObject({
      ok: false,
      reason: 'invalid-region',
    });
    expect(addSavedPlace([], { regionCpu: 'kyiv-city', queue: '??' })).toMatchObject({
      ok: false,
      reason: 'invalid-queue',
    });
  });

  it('не створює копію тієї самої адреси навіть з іншою чергою', () => {
    const existing = [place({ id: 'home', label: 'Дім', queue: '1', settlementName: 'Київ' })];
    const result = addSavedPlace(existing, {
      regionCpu: 'kyiv-city',
      queue: '4',
      settlementName: 'київ',
      label: 'Дім 2',
    });
    expect(result.ok).toBe(false);
    expect(result.duplicate?.id).toBe('home');
    expect(result.places).toHaveLength(1);
  });

  it('дозволяє ту саму назву для різних адрес і робить нове місце головним за прапорцем', () => {
    const existing = [place({ id: 'home', label: 'Дім', settlementName: 'Київ' })];
    const result = addSavedPlace(existing, {
      regionCpu: 'kyiv-city',
      queue: '2',
      settlementName: 'Львів',
      streetName: 'Ринок',
      label: 'Дім',
      makePrimary: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.places).toHaveLength(2);
    expect(result.places.filter((item) => item.isPrimary)).toHaveLength(1);
    expect(result.place.isPrimary).toBe(true);
  });

  it('не додає понад ліміт місць', () => {
    const places = Array.from({ length: MAX_SAVED_PLACES }, (_, index) =>
      place({ id: `p${index}`, settlementName: `Село ${index}` }),
    );
    expect(
      addSavedPlace(places, { regionCpu: 'kyiv-city', queue: '1', settlementName: 'Нове' }),
    ).toMatchObject({ ok: false, reason: 'limit' });
  });
});

describe('editing saved places', () => {
  it('перейменовує, але порожня назва не стирає стару', () => {
    const places = [place({ id: 'a', label: 'Дім' })];
    expect(renameSavedPlace(places, 'a', '  Офіс  ')[0]!.label).toBe('Офіс');
    expect(renameSavedPlace(places, 'a', '   ')[0]!.label).toBe('Дім');
  });

  it('змінює іконку і чергу, ігноруючи невідомі значення', () => {
    const places = [place({ id: 'a', queue: '1', addressConfirmed: undefined })];
    expect(setSavedPlaceIcon(places, 'a', 'office')[0]!.icon).toBe('office');
    expect(setSavedPlaceIcon(places, 'a', 'rocket' as never)[0]!.icon).toBe('home');

    const changed = setSavedPlaceQueue(places, 'a', '3');
    expect(changed[0]).toMatchObject({ queue: '3', addressConfirmed: true });
    expect(setSavedPlaceQueue(places, 'a', '???')[0]!.queue).toBe('1');
  });

  it('перемикає головне місце рівно одне', () => {
    const places = [place({ id: 'a', isPrimary: true }), place({ id: 'b', settlementName: 'Інше' })];
    const next = setSavedPlacePrimary(places, 'b');
    expect(next.filter((item) => item.isPrimary)).toHaveLength(1);
    expect(next[1]!.isPrimary).toBe(true);
    expect(setSavedPlacePrimary(places, 'nope')).toEqual(places);
  });

  it('після видалення головного головним стає перше з решти', () => {
    const places = [
      place({ id: 'a', isPrimary: true }),
      place({ id: 'b', settlementName: 'Інше' }),
      place({ id: 'c', settlementName: 'Третє' }),
    ];
    const next = removeSavedPlace(places, 'a');
    expect(next.map((item) => item.id)).toEqual(['b', 'c']);
    expect(next[0]!.isPrimary).toBe(true);
    expect(next[1]!.isPrimary).toBe(false);
  });
});

describe('ordering and restore', () => {
  const places = [
    place({ id: 'a', isPrimary: true }),
    place({ id: 'b', settlementName: 'Б' }),
    place({ id: 'c', settlementName: 'В' }),
  ];

  it('рухає місце в межах списку й не виходить за краї', () => {
    expect(moveSavedPlace(places, 'c', -1).map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(moveSavedPlace(places, 'a', -1).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(moveSavedPlace(places, 'c', 1).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('повертає видалене місце на його позицію', () => {
    const removed = places[1]!;
    const without = removeSavedPlace(places, 'b');
    const restored = restoreSavedPlace(without, removed, 1);
    expect(restored.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('не відновлює дублікат і не перевищує ліміт', () => {
    expect(restoreSavedPlace(places, places[0]!, 0).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    const full = Array.from({ length: MAX_SAVED_PLACES }, (_, index) =>
      place({ id: `f${index}`, settlementName: `Село ${index}` }),
    );
    expect(restoreSavedPlace(full, place({ id: 'new', settlementName: 'Нове' }), 0)).toHaveLength(
      MAX_SAVED_PLACES,
    );
  });

  it('робить перше місце головним, якщо жодне не позначене', () => {
    const noPrimary = [place({ id: 'a' }), place({ id: 'b', settlementName: 'Б' })];
    expect(ensurePrimary(noPrimary)[0]!.isPrimary).toBe(true);
    expect(ensurePrimary([])).toEqual([]);
  });

  it('знаходить місце для поточної області й черги', () => {
    expect(findSavedPlaceFor(places, 'kyiv-city', '1')?.id).toBe('a');
    expect(findSavedPlaceFor(places, 'kyiv-city', '9')).toBeNull();
  });
});

describe('storage envelope', () => {
  it('пише конверт v2 і читає його без міграції', () => {
    const storage = new MockStorage();
    const places = [place({ id: 'a', label: 'Дім' })];
    storage.setItem(SAVED_PLACES_KEY, serializeSavedPlaces(places));

    const read = readRawSavedPlaces(storage);
    expect(read.migrated).toBe(false);
    expect(migrateSavedPlaces(read.raw)).toHaveLength(1);
  });

  it('відкочується на старий ключ закладок і позначає міграцію', () => {
    const storage = new MockStorage();
    storage.setItem(
      LEGACY_BOOKMARKS_KEY,
      JSON.stringify([{ id: 'old', regionCpu: 'kyiv-city', queue: '1', label: 'Дім' }]),
    );

    const read = readRawSavedPlaces(storage);
    expect(read.migrated).toBe(true);
    expect(migrateSavedPlaces(read.raw)[0]).toMatchObject({ id: 'old', label: 'Дім' });
  });

  it('не валить застосунок на битому JSON', () => {
    const storage = new MockStorage();
    storage.setItem(SAVED_PLACES_KEY, '{broken');
    expect(readRawSavedPlaces(storage)).toEqual({ raw: [], migrated: false });
    expect(migrateSavedPlaces(readRawSavedPlaces(storage).raw)).toEqual([]);
  });
});
