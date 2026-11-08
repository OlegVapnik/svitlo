/**
 * Коди черг у збережених місцях («Мої місця»).
 *
 * Регресія з живого застосунку: місце з групою `35` у Києві показувало «Черга 3/5», а `44` —
 * «4/4». Причина була в евристиці «двозначне число без слеша = дві цифри підгрупи»: вона
 * народилася за часів 12 підгруп ГПВ, але Київ публікує десятки плоских черг (`10…60`), і
 * розрізання робило збережену групу неіснуючою.
 */
import { describe, expect, it } from 'vitest';

import {
  addSavedPlace,
  canonicalizeQueueCode,
  migrateSavedPlaces,
  setSavedPlaceQueue,
  type SavedPlace,
} from '../src/lib/saved-places.ts';

const place = (queue: string, regionCpu = 'kyiv-city'): SavedPlace => ({
  id: 'place-1',
  label: 'Дім',
  icon: 'home',
  regionCpu,
  queue,
  createdAt: 1,
});

describe('canonicalizeQueueCode', () => {
  it('двозначні черги не розрізає на X/Y', () => {
    expect(canonicalizeQueueCode('35')).toBe('35');
    expect(canonicalizeQueueCode('44')).toBe('44');
    expect(canonicalizeQueueCode('10')).toBe('10');
    expect(canonicalizeQueueCode('60')).toBe('60');
  });

  it('двозначні підгрупи зберігає як є', () => {
    expect(canonicalizeQueueCode('35/1')).toBe('35/1');
    expect(canonicalizeQueueCode('44/1')).toBe('44/1');
    expect(canonicalizeQueueCode('29/1')).toBe('29/1');
    expect(canonicalizeQueueCode('12/3')).toBe('12/3');
  });

  it('класичні 12 підгруп не ламає', () => {
    expect(canonicalizeQueueCode('1/1')).toBe('1/1');
    expect(canonicalizeQueueCode('6/2')).toBe('6/2');
    expect(canonicalizeQueueCode('1.1')).toBe('1/1');
  });

  it('для Києва плоский код вирівнює до підгрупи 1, як це робить графік', () => {
    expect(canonicalizeQueueCode('3', 'kyiv-city')).toBe('3/1');
    expect(canonicalizeQueueCode('35', 'kyiv-city')).toBe('35/1');
    // Поза Києвом «1» і «1/1» — різні черги, тому код лишається плоским.
    expect(canonicalizeQueueCode('1', 'chernihivska-oblast')).toBe('1');
  });
});

describe('місця з двозначною чергою', () => {
  it('додає місце з 35 і показує його як 35/1 у Києві', () => {
    const result = addSavedPlace([], {
      label: 'Дім',
      regionCpu: 'kyiv-city',
      queue: '35',
      makePrimary: true,
    });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.place.queue : undefined).toBe('35/1');
  });

  it('місце з 44/1 лишається 44/1', () => {
    const result = addSavedPlace([], { label: 'Робота', regionCpu: 'kyiv-city', queue: '44/1' });
    expect(result.ok ? result.place.queue : undefined).toBe('44/1');
  });

  it('читання зі сховища не перетворює 35 на 3/5', () => {
    const places = migrateSavedPlaces([place('35')]);
    expect(places[0]?.queue).toBe('35/1');
  });

  it('зміна черги не ріже двозначний код', () => {
    const next = setSavedPlaceQueue([place('1/1')], 'place-1', '29/1');
    expect(next[0]?.queue).toBe('29/1');
  });

  it('двозначний код поза Києвом лишається плоским', () => {
    const result = addSavedPlace([], { label: 'Дім', regionCpu: 'chernihivska-oblast', queue: '35' });
    expect(result.ok ? result.place.queue : undefined).toBe('35');
  });
});
