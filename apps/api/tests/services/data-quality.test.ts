import { describe, expect, it } from 'vitest';
import {
  timeToMinutes,
  validateScheduleSlots,
  type ScheduleSlotCandidate,
} from '../../src/services/data-quality.js';

describe('data-quality: timeToMinutes helper', () => {
  it('перетворює валідні часи у хвилини', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('коректно обробляє кінець доби', () => {
    expect(timeToMinutes('00:00', true)).toBe(1440);
    expect(timeToMinutes('24:00', true)).toBe(1440);
  });

  it('повертає null для некоректного формату', () => {
    expect(timeToMinutes('25:00')).toBeNull();
    expect(timeToMinutes('12:60')).toBeNull();
    expect(timeToMinutes('bad')).toBeNull();
  });
});

describe('data-quality: validateScheduleSlots (злі кейси)', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');
  const baseSlot: ScheduleSlotCandidate = {
    queue: '1/1',
    date: '2026-10-11',
    timeFrom: '08:00',
    timeTo: '10:00',
    stateCode: 3,
    stateName: 'Відключення',
    stateColor: '#E33535',
  };

  it('1. Порожній набір слотів -> помилка EMPTY_SET', () => {
    const res = validateScheduleSlots([], { now });
    expect(res.valid).toBe(false);
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected).toHaveLength(0);
    expect(res.errors[0]).toContain('EMPTY_SET');
  });

  it('2. Некоректний формат дати -> DATE_MISMATCH', () => {
    const res = validateScheduleSlots([{ ...baseSlot, date: '11.10.2026' }], { now });
    expect(res.valid).toBe(false);
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]!.code).toBe('DATE_MISMATCH');
  });

  it('3. Очікувалася інша дата -> DATE_MISMATCH', () => {
    const res = validateScheduleSlots([baseSlot], { now, expectedDate: '2026-10-12' });
    expect(res.valid).toBe(false);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]!.code).toBe('DATE_MISMATCH');
  });

  it('4. Дата з минулого без allowPastDates -> PAST_DATE', () => {
    const res = validateScheduleSlots([{ ...baseSlot, date: '2026-10-09' }], { now });
    expect(res.valid).toBe(false);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]!.code).toBe('PAST_DATE');
  });

  it('5. Дата з минулого з allowPastDates: true -> успішно прийнята', () => {
    const res = validateScheduleSlots([{ ...baseSlot, date: '2026-10-09' }], { now, allowPastDates: true });
    expect(res.valid).toBe(true);
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected).toHaveLength(0);
  });

  it('6. Код стану поза діапазоном 1..3 (0, 4, -1, 99) -> INVALID_STATE_CODE', () => {
    const badCodes = [0, 4, -1, 99];
    for (const code of badCodes) {
      const res = validateScheduleSlots([{ ...baseSlot, stateCode: code }], { now });
      expect(res.valid).toBe(false);
      expect(res.rejected[0]!.code).toBe('INVALID_STATE_CODE');
    }
  });

  it('7. Некоректний часовий інтервал (timeTo <= timeFrom) -> INVALID_TIME_RANGE', () => {
    const res = validateScheduleSlots([{ ...baseSlot, timeFrom: '12:00', timeTo: '10:00' }], { now });
    expect(res.valid).toBe(false);
    expect(res.rejected[0]!.code).toBe('INVALID_TIME_RANGE');

    const equalRes = validateScheduleSlots([{ ...baseSlot, timeFrom: '10:00', timeTo: '10:00' }], { now });
    expect(equalRes.valid).toBe(false);
    expect(equalRes.rejected[0]!.code).toBe('INVALID_TIME_RANGE');
  });

  it('8. Дублікати слотів (однакові queue, date, timeFrom) -> другий DUPLICATE_SLOT', () => {
    const slots = [
      { ...baseSlot, timeFrom: '08:00', timeTo: '10:00' },
      { ...baseSlot, timeFrom: '08:00', timeTo: '11:00' },
    ];
    const res = validateScheduleSlots(slots, { now });
    expect(res.valid).toBe(false);
    expect(res.rejected.some((r) => r.code === 'DUPLICATE_SLOT')).toBe(true);
  });

  it('9. Перетин інтервалів для однієї черги та дати -> OVERLAPPING_INTERVALS', () => {
    const slots = [
      { ...baseSlot, timeFrom: '08:00', timeTo: '11:00' },
      { ...baseSlot, timeFrom: '10:00', timeTo: '13:00' },
    ];
    const res = validateScheduleSlots(slots, { now });
    expect(res.valid).toBe(false);
    expect(res.rejected.every((r) => r.code === 'OVERLAPPING_INTERVALS')).toBe(true);
  });

  it('10. Суміжні неперетинні інтервали (10:00-12:00 і 12:00-14:00) -> валідні', () => {
    const slots = [
      { ...baseSlot, timeFrom: '10:00', timeTo: '12:00' },
      { ...baseSlot, timeFrom: '12:00', timeTo: '14:00' },
    ];
    const res = validateScheduleSlots(slots, { now });
    expect(res.valid).toBe(true);
    expect(res.accepted).toHaveLength(2);
    expect(res.rejected).toHaveLength(0);
  });

  it('11. Більше 12 годин відключень на добу (14 год) -> EXCESSIVE_OUTAGE_DURATION', () => {
    const slots = [
      { ...baseSlot, timeFrom: '00:00', timeTo: '08:00', stateCode: 3 }, // 8 год
      { ...baseSlot, timeFrom: '10:00', timeTo: '16:00', stateCode: 3 }, // 6 год = разом 14 год > 12 год
    ];
    const res = validateScheduleSlots(slots, { now });
    expect(res.valid).toBe(false);
    expect(res.rejected[0]!.code).toBe('EXCESSIVE_OUTAGE_DURATION');
  });

  it('12. Рівно або менше 12 годин відключень (4 + 4 = 8 год) -> валідно', () => {
    const slots = [
      { ...baseSlot, timeFrom: '08:00', timeTo: '12:00', stateCode: 3 },
      { ...baseSlot, timeFrom: '16:00', timeTo: '20:00', stateCode: 3 },
    ];
    const res = validateScheduleSlots(slots, { now });
    expect(res.valid).toBe(true);
    expect(res.accepted).toHaveLength(2);
  });

  it('13. Стан "світло є" (код 1) не зараховується до тривалості відключень', () => {
    const slots = [
      { ...baseSlot, timeFrom: '00:00', timeTo: '14:00', stateCode: 1 }, // 14 год світло є
      { ...baseSlot, timeFrom: '14:00', timeTo: '18:00', stateCode: 3 }, // 4 год відключення
    ];
    const res = validateScheduleSlots(slots, { now });
    expect(res.valid).toBe(true);
    expect(res.accepted).toHaveLength(2);
  });

  it('14. Змішаний пакет: невалідні відхиляються, валідні зберігаються', () => {
    const slots = [
      baseSlot, // валідний (1/1, 08:00-10:00)
      { ...baseSlot, queue: '2/1', stateCode: 99 }, // невалідний код стану
      { ...baseSlot, queue: '3/1', timeFrom: '12:00', timeTo: '08:00' }, // невалідний час
    ];
    const res = validateScheduleSlots(slots, { now });
    expect(res.valid).toBe(false);
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]!.queue).toBe('1/1');
    expect(res.rejected).toHaveLength(2);
  });
});
