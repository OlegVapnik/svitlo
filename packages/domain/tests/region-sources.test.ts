import { describe, expect, it } from 'vitest';

import {
  REGION_SOURCES,
  addressBypassOf,
  regionSourceOf,
} from '../src/region-sources.ts';

describe('region-sources', () => {
  it('рівно 24 записи, унікальні cpu', () => {
    expect(REGION_SOURCES).toHaveLength(24);
    expect(new Set(REGION_SOURCES.map((source) => source.region)).size).toBe(24);
  });

  it('у кожного регіону є безрахунковий URL, підказка і хоча б один офіційний домен', () => {
    for (const source of REGION_SOURCES) {
      expect(source.addressLookupBypassUrl, source.region).toMatch(/^https:\/\//);
      // Підказка — українська, не порожня і без посилань.
      expect(source.bypassHintUk.trim().length, source.region).toBeGreaterThan(8);
      expect(source.bypassHintUk, source.region).toMatch(/[А-Яа-яІіЇїЄєҐґ]/);
      expect(source.officialDomains.length, source.region).toBeGreaterThan(0);
      for (const domain of source.officialDomains) {
        expect(domain, source.region).not.toMatch(/^https?:\/\//);
      }
    }
  });

  it('безрахункові URL ведуть на офіційний домен оператора, а не на агрегатор', () => {
    for (const source of REGION_SOURCES) {
      const host = new URL(source.addressLookupBypassUrl).host.replace(/^www\./, '');
      const official = source.officialDomains.some(
        (domain) => host === domain || host.endsWith(`.${domain}`),
      );
      expect(official, `${source.region}: ${host}`).toBe(true);
      expect(host, source.region).not.toContain('energy-ua.info');
    }
  });

  it('регіон за кодом: Чернігів — домен і Telegram-канал', () => {
    const source = regionSourceOf('chernihivska-oblast');
    expect(source).not.toBeNull();
    expect(source!.officialDomains).toContain('chernihivoblenergo.com.ua');
    expect(source!.telegramChannel).toBe('chernigivoblenergo');
    expect(source!.mirrorHost).toBe('chernigiv.energy-ua.info');
  });

  it('прямі офіційні точки входу ДТЕК ведуть на /ua/shutdowns', () => {
    for (const region of [
      'kyiv-city',
      'kyivska-oblast',
      'dnipropetrovska-oblast',
      'donetska-oblast',
      'odeska-oblast',
    ]) {
      expect(regionSourceOf(region)!.addressLookupBypassUrl, region).toMatch(/\/ua\/shutdowns$/);
    }
  });

  it('Львів, Миколаїв, Івано-Франківськ і Суми — офіційні безрахункові сервіси', () => {
    expect(regionSourceOf('lvivska-oblast')!.addressLookupBypassUrl).toBe(
      'https://poweron.loe.lviv.ua/',
    );
    expect(regionSourceOf('mykolaivska-oblast')!.addressLookupBypassUrl).toBe(
      'https://off.energy.mk.ua/',
    );
    expect(regionSourceOf('ivano-frankivska-oblast')!.addressLookupBypassUrl).toBe(
      'https://svitlo.oe.if.ua/',
    );
    expect(regionSourceOf('sumska-oblast')!.addressLookupBypassUrl).toBe('https://www.soe.com.ua/');
    expect(regionSourceOf('khersonska-oblast')!.addressLookupBypassUrl).toBe(
      'https://www.ksoe.com.ua/',
    );
  });

  it('addressBypassOf повертає URL, підказку й назву або null', () => {
    const bypass = addressBypassOf('ternopilska-oblast');
    expect(bypass).not.toBeNull();
    expect(bypass!.url).toBe('https://poweron.toe.com.ua/');
    expect(bypass!.nameUa).toBe('Тернопільська область');
    expect(bypass!.hintUk.length).toBeGreaterThan(8);
    expect(addressBypassOf('luhanska-oblast')).toBeNull();
    expect(addressBypassOf('')).toBeNull();
  });

  it('невідомий регіон → null', () => {
    expect(regionSourceOf('luhanska-oblast')).toBeNull();
    expect(regionSourceOf('')).toBeNull();
  });

  it('відсутність дзеркала/каналу — чесний null', () => {
    expect(regionSourceOf('kyiv-city')!.mirrorHost).toBeNull();
    expect(regionSourceOf('kyiv-city')!.telegramChannel).toBeNull();
    expect(regionSourceOf('sumska-oblast')!.telegramChannel).toBe('SumyEnergo');
  });

  it('немає емодзі в назвах і підказках', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const source of REGION_SOURCES) {
      expect(emoji.test(source.nameUa), source.region).toBe(false);
      expect(emoji.test(source.bypassHintUk), source.region).toBe(false);
    }
  });
});
