/**
 * Обчислює стан «аварії», утвореної з відключення оператора, відносно поточного моменту.
 *
 * Раніше всі такі записи показувались як «Триває», навіть заплановані на наступний тиждень
 * ремонтні роботи. Тепер стан залежить від часового вікна відключення.
 */
export type IncidentState = 'scheduled' | 'active' | 'resolved';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export function outageIncidentState(startsAt: Date, endsAt: Date, now: Date = new Date()): IncidentState {
  const start = startsAt.getTime();
  const end = endsAt.getTime();
  const current = now.getTime();
  if (start > current) return 'scheduled';
  if (end < current) return 'resolved';
  return 'active';
}

/** Активні події — високий пріоритет, заплановані — середній, усунені — низький. */
export function severityForState(state: IncidentState): IncidentSeverity {
  switch (state) {
    case 'active':
      return 'high';
    case 'scheduled':
      return 'medium';
    default:
      return 'low';
  }
}
