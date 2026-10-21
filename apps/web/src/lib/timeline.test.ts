import { describe, expect, it } from 'vitest';
import type { ScheduleIntervalUtc } from '@svitlo/shared';
import {
  clampHour,
  formatHour,
  generateTimelineSlots,
  getCurrentTimeMarker,
  getHourSummary,
  getKyivNowMinutes,
} from './timeline.js';

describe('timeline maths and helpers', () => {
  it('clamps hours within 0..23', () => {
    expect(clampHour(-5)).toBe(0);
    expect(clampHour(0)).toBe(0);
    expect(clampHour(14)).toBe(14);
    expect(clampHour(23)).toBe(23);
    expect(clampHour(30)).toBe(23);
  });

  it('formats hour string correctly', () => {
    expect(formatHour(0)).toBe('00:00');
    expect(formatHour(9)).toBe('09:00');
    expect(formatHour(14)).toBe('14:00');
    expect(formatHour(23)).toBe('23:00');
  });

  it('generates exactly 48 half-hour slots for a 24-hour day', () => {
    const slots = generateTimelineSlots([], '2026-10-11');
    expect(slots).toHaveLength(48);

    expect(slots[0]).toMatchObject({
      index: 0,
      hour: 0,
      minute: 0,
      startMinutes: 0,
      endMinutes: 30,
      timeLabel: '00:00',
      rangeLabel: '00:00–00:30',
      stateCode: null,
    });

    expect(slots[47]).toMatchObject({
      index: 47,
      hour: 23,
      minute: 30,
      startMinutes: 1410,
      endMinutes: 1440,
      timeLabel: '23:30',
      rangeLabel: '23:30–24:00',
      stateCode: null,
    });
  });

  it('correctly maps schedule intervals to half-hour slots in Kyiv time', () => {
    // 2026-10-11 in Kyiv is UTC+3 (summer time).
    // An interval from 13:00 UTC to 16:30 UTC corresponds to 16:00–19:30 Kyiv time.
    const intervals: ScheduleIntervalUtc[] = [
      {
        startsAt: '2026-10-11T13:00:00.000Z',
        endsAt: '2026-10-11T16:30:00.000Z',
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
      },
    ];

    const slots = generateTimelineSlots(intervals, '2026-10-11');

    // Slot at 15:30 (index 31): fromMinutes=930 (15:30 Kyiv) -> should NOT be off (stateCode 1, power on)
    const beforeSlot = slots[31]!;
    expect(beforeSlot.timeLabel).toBe('15:30');
    expect(beforeSlot.stateCode).toBe(1);

    // Slots from 16:00 (index 32) to 19:00 (index 38): should be off (stateCode 3)
    const offSlot1 = slots[32]!; // 16:00–16:30
    expect(offSlot1.timeLabel).toBe('16:00');
    expect(offSlot1.stateCode).toBe(3);
    expect(offSlot1.stateName).toBe('Відключення');

    const offSlotLast = slots[38]!; // 19:00–19:30
    expect(offSlotLast.timeLabel).toBe('19:00');
    expect(offSlotLast.stateCode).toBe(3);

    // Slot at 19:30 (index 39): 19:30–20:00 -> not off (stateCode 1, power on)
    const afterSlot = slots[39]!;
    expect(afterSlot.timeLabel).toBe('19:30');
    expect(afterSlot.stateCode).toBe(1);

  });

  it('calculates current time marker only when date is Kyiv today', () => {
    // Fixed now instant: 2026-10-11T11:30:00Z -> Kyiv 14:30 (minute 870)
    const fixedNow = new Date('2026-10-11T11:30:00.000Z');

    const todayMarker = getCurrentTimeMarker('2026-10-11', fixedNow);
    expect(todayMarker).not.toBeNull();
    expect(todayMarker?.nowMinutes).toBe(870);
    expect(todayMarker?.timeFormatted).toBe('14:30');
    expect(todayMarker?.percent).toBeCloseTo((870 / 1440) * 100, 2);

    // Different date (e.g. tomorrow)
    const tomorrowMarker = getCurrentTimeMarker('2026-10-12', fixedNow);
    expect(tomorrowMarker).toBeNull();
  });

  it('marks current and past slots accurately', () => {
    const fixedNow = new Date('2026-10-11T11:45:00.000Z'); // Kyiv 14:45
    const slots = generateTimelineSlots([], '2026-10-11', fixedNow);

    // Slot 14:30–15:00 (index 29) contains 14:45
    expect(slots[29]?.timeLabel).toBe('14:30');
    expect(slots[29]?.isCurrent).toBe(true);
    expect(slots[29]?.isPast).toBe(false);

    // Slot 14:00–14:30 (index 28) is in the past
    expect(slots[28]?.isPast).toBe(true);
    expect(slots[28]?.isCurrent).toBe(false);

    // Slot 15:00–15:30 (index 30) is in the future
    expect(slots[30]?.isPast).toBe(false);
    expect(slots[30]?.isCurrent).toBe(false);
  });

  it('builds accessible hour summaries with aria announcements', () => {
    const intervals: ScheduleIntervalUtc[] = [
      {
        startsAt: '2026-10-11T11:00:00.000Z', // Kyiv 14:00
        endsAt: '2026-10-11T12:00:00.000Z',   // Kyiv 15:00
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
      },
    ];

    const slots = generateTimelineSlots(intervals, '2026-10-11');
    const summary = getHourSummary(slots, 14);

    expect(summary.hour).toBe(14);
    expect(summary.label).toBe('14:00–15:00');
    expect(summary.hasOff).toBe(true);
    expect(summary.allOff).toBe(true);
    expect(summary.ariaAnnouncement).toContain('14:00–15:00');
    expect(summary.ariaAnnouncement).toContain('Відключення');
  });
});
