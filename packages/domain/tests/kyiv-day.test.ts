/**
 * Межі київської доби.
 *
 * Тут фіксуються дві речі, на яких легко помилитися:
 * 1. початок доби залежить від сезону (UTC+3 влітку, UTC+2 взимку);
 * 2. у ночі переводу стрілок доба триває 23 або 25 годин, тому кінець доби — це
 *    місцева північ наступної дати, а не «початок + 24 години».
 */
import { describe, expect, it } from 'vitest';

import { kyivDayStart, kyivNextDayStart, outageOverlapsKyivDay } from '../src/kyiv-day.ts';

const at = (iso: string): Date => new Date(iso);
const iso = (date: Date): string => date.toISOString();

describe('kyivDayStart', () => {
  it('влітку доба починається о 21:00Z попереднього дня (UTC+3)', () => {
    expect(iso(kyivDayStart(at('2026-10-17T12:00:00Z')))).toBe('2026-10-16T21:00:00.000Z');
  });

  it('взимку доба починається о 22:00Z попереднього дня (UTC+2)', () => {
    expect(iso(kyivDayStart(at('2026-01-15T12:00:00Z')))).toBe('2026-01-14T22:00:00.000Z');
  });

  it('о 00:30 за Києвом це вже наступна доба', () => {
    expect(iso(kyivDayStart(at('2026-10-17T21:30:00Z')))).toBe('2026-10-17T21:00:00.000Z');
  });

  it('о 23:30 за Києвом це ще поточна доба', () => {
    expect(iso(kyivDayStart(at('2026-10-17T20:30:00Z')))).toBe('2026-10-16T21:00:00.000Z');
  });
});

describe('kyivNextDayStart', () => {
  it('у ніч переходу на зимовий час доба триває 25 годин', () => {
    // 25.10.2026: о 04:00 за Києвом стрілки йдуть назад.
    const day = at('2026-10-25T12:00:00Z');
    const start = kyivDayStart(day).getTime();
    const next = kyivNextDayStart(day).getTime();
    expect(iso(new Date(start))).toBe('2026-10-24T21:00:00.000Z');
    expect(iso(new Date(next))).toBe('2026-10-25T22:00:00.000Z');
    expect((next - start) / 3_600_000).toBe(25);
  });

  it('у ніч переходу на літній час доба триває 23 години', () => {
    const day = at('2026-03-29T12:00:00Z');
    const start = kyivDayStart(day).getTime();
    const next = kyivNextDayStart(day).getTime();
    expect(iso(new Date(start))).toBe('2026-03-28T22:00:00.000Z');
    expect(iso(new Date(next))).toBe('2026-03-29T21:00:00.000Z');
    expect((next - start) / 3_600_000).toBe(23);
  });
});

describe('outageOverlapsKyivDay', () => {
  it('перетин усередині доби', () => {
    expect(
      outageOverlapsKyivDay('2026-10-17T20:00:00Z', '2026-10-17T20:30:00Z', at('2026-10-17T12:00:00Z')),
    ).toBe(true);
  });

  it('подія рівно на початку доби належить цій добі', () => {
    expect(
      outageOverlapsKyivDay('2026-10-16T21:00:00Z', '2026-10-16T22:00:00Z', at('2026-10-17T12:00:00Z')),
    ).toBe(true);
  });

  it('подія, що почалася рівно о 00:00 наступної доби, до попередньої не належить', () => {
    expect(
      outageOverlapsKyivDay('2026-10-17T21:00:00Z', '2026-10-17T22:00:00Z', at('2026-10-17T12:00:00Z')),
    ).toBe(false);
  });

  it('остання година 25-годинної доби не губиться', () => {
    // 23:30–24:00 за Києвом 25.10.2026 — це 21:30Z–22:00Z. Якщо рахувати кінець доби як
    // «початок + 24 год» (21:00Z), цей інтервал випадав би з 25 жовтня і потрапляв у 26-те.
    const late = ['2026-10-25T21:30:00Z', '2026-10-25T22:00:00Z'] as const;
    expect(outageOverlapsKyivDay(late[0], late[1], at('2026-10-25T12:00:00Z'))).toBe(true);
    // 26 жовтня цей самий інтервал не перетинає: він лише торкається його початку,
    // а всередині 26-го лежить уже інший час.
    expect(
      outageOverlapsKyivDay('2026-10-26T00:30:00Z', '2026-10-26T01:00:00Z', at('2026-10-25T12:00:00Z')),
    ).toBe(false);
  });
});
