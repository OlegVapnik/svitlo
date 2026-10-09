import { describe, expect, test } from 'vitest';
import { outageIncidentState, severityForState } from '../../src/services/incident-status.js';

describe('outage incident state', () => {
  const now = new Date('2026-10-08T22:30:00.000Z');

  test('marks future outages as scheduled (not active)', () => {
    const state = outageIncidentState(new Date('2026-10-16T05:00:00.000Z'), new Date('2026-10-16T14:00:00.000Z'), now);
    expect(state).toBe('scheduled');
    expect(severityForState(state)).toBe('medium');
  });

  test('marks outages covering now as active', () => {
    const state = outageIncidentState(new Date('2026-10-08T20:00:00.000Z'), new Date('2026-10-09T02:00:00.000Z'), now);
    expect(state).toBe('active');
    expect(severityForState(state)).toBe('high');
  });

  test('marks past outages as resolved', () => {
    const state = outageIncidentState(new Date('2026-10-07T14:30:00.000Z'), new Date('2026-10-07T18:00:00.000Z'), now);
    expect(state).toBe('resolved');
    expect(severityForState(state)).toBe('low');
  });
});
