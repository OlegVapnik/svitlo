import { describe, expect, it } from 'vitest';

import { unionMinutesInWindow } from '../src/reliability.ts';

const ms = (iso: string): number => Date.parse(iso);

describe('unionMinutesInWindow', () => {
  it('рахує суму хвилин без світла', () => {
    const slots = [
      { startMs: ms('2026-10-17T15:00:00Z'), endMs: ms('2026-10-17T16:00:00Z') },
      { startMs: ms('2026-10-17T18:00:00Z'), endMs: ms('2026-10-17T18:30:00Z') },
    ];
    expect(unionMinutesInWindow(slots, ms('2026-10-17T00:00:00Z'), ms('2026-10-18T00:00:00Z'))).toEqual({
      minutes: 90,
      count: 2,
    });
  });

  it('не рахує перетин двічі', () => {
    // 22:00–01:00 і 23:00–00:30 перекриваються: обʼєднання — три години, а не чотири з половиною.
    const slots = [
      { startMs: ms('2026-10-17T22:00:00Z'), endMs: ms('2026-10-18T01:00:00Z') },
      { startMs: ms('2026-10-17T23:00:00Z'), endMs: ms('2026-10-18T00:30:00Z') },
    ];
    expect(unionMinutesInWindow(slots, ms('2026-10-17T00:00:00Z'), ms('2026-10-19T00:00:00Z')).minutes).toBe(180);
  });

  it('склеює дотичні слоти в одне вікно', () => {
    const slots = [
      { startMs: ms('2026-10-17T22:00:00Z'), endMs: ms('2026-10-18T01:00:00Z') },
      { startMs: ms('2026-10-18T01:00:00Z'), endMs: ms('2026-10-18T02:00:00Z') },
    ];
    expect(unionMinutesInWindow(slots, ms('2026-10-17T00:00:00Z'), ms('2026-10-19T00:00:00Z'))).toEqual({
      minutes: 240,
      count: 2,
    });
  });

  it('обрізає слот межами вікна', () => {
    const slots = [{ startMs: ms('2026-10-17T22:00:00Z'), endMs: ms('2026-10-18T02:00:00Z') }];
    expect(unionMinutesInWindow(slots, ms('2026-10-18T00:00:00Z'), ms('2026-10-18T23:59:59Z')).minutes).toBe(120);
    expect(unionMinutesInWindow(slots, ms('2026-10-17T23:00:00Z'), ms('2026-10-18T01:00:00Z')).minutes).toBe(120);
  });

  it('порожнє вікно й порожні слоти дають нуль', () => {
    expect(unionMinutesInWindow([], ms('2026-10-17T00:00:00Z'), ms('2026-10-18T00:00:00Z'))).toEqual({
      minutes: 0,
      count: 0,
    });
    const outside = [{ startMs: ms('2026-10-20T10:00:00Z'), endMs: ms('2026-10-20T11:00:00Z') }];
    expect(unionMinutesInWindow(outside, ms('2026-10-17T00:00:00Z'), ms('2026-10-18T00:00:00Z'))).toEqual({
      minutes: 0,
      count: 0,
    });
  });
});
