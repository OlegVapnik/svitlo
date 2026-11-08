import { describe, expect, it } from 'vitest';

import { resolveScheduleDate } from '../src/schedule-date.ts';

const published = (iso: string): Date => new Date(iso);

describe('resolveScheduleDate', () => {
  it('бере конкретну дату з тексту', () => {
    expect(resolveScheduleDate('Графік на 9 жовтня', published('2026-10-05T09:00:00Z'))).toBe('2026-10-09');
  });

  it('розуміє «сьогодні» й «завтра»', () => {
    const at = published('2026-10-05T09:00:00Z');
    expect(resolveScheduleDate('сьогодні з 16:00', at)).toBe('2026-10-05');
    expect(resolveScheduleDate('завтра з 16:00', at)).toBe('2026-10-06');
  });

  it('рахує дату публікації за Києвом, а не за UTC', () => {
    // 22:30Z 27 жовтня — це вже 28 жовтня за Києвом (UTC+2 узимку).
    expect(resolveScheduleDate('без дати', published('2026-10-27T22:30:00Z'))).toBe('2026-10-28');
  });

  it('переходить на наступний рік, якщо дата з минулого більш ніж на тиждень', () => {
    expect(resolveScheduleDate('на 5 січня', published('2026-12-28T09:00:00Z'))).toBe('2027-01-05');
  });

  it('лишає цьогорічну дату, якщо вона в межах тижня назад', () => {
    expect(resolveScheduleDate('на 28 грудня', published('2026-12-31T09:00:00Z'))).toBe('2026-12-28');
  });

  it('без дати в тексті повертає дату публікації', () => {
    expect(resolveScheduleDate('черга 6/2 з 16:40 до 18:30', published('2026-10-05T09:00:00Z'))).toBe(
      '2026-10-05',
    );
  });
});
