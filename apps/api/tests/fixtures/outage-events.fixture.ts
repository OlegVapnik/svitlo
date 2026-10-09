/**
 * Фікстура «30 адресних рядків = 6 подій» (migration-plan.md §1): два вікна одного дня з однаковою
 * причиною, ремонт, скасоване вікно, відкрита аварія (без завершення) і заплановане вікно.
 *
 * Одна фікстура на всі інтеграційні тести: і /outages, і backfill мусять бачити ті самі 30 рядків.
 * Дані синтетичні, адреси вигадані, персональних даних немає (skills/secrets-pii-hygiene).
 */
export interface FixtureEvent {
  label: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: 'scheduled' | 'active' | 'finished' | 'cancelled';
  street: string;
}

/** Заморожене «зараз»: 2026-10-09 12:00 за Києвом (EEST, UTC+3). */
export const NOW = new Date('2026-10-09T09:00:00Z');

/** 6 подій × 5 адресних рядків = 30 сирих рядків. */
export const ADDRESSES_PER_EVENT = 5;

export const SOURCE_ID = '00000000-0000-4000-8000-000000000001';
export const AREA = 'с. Деснянське';

export const FIXTURE: FixtureEvent[] = [
  {
    label: 'regime-window-1',
    startsAt: '2026-10-08T08:00:00+03:00',
    endsAt: '2026-10-08T10:00:00+03:00',
    reason: 'Заходи обмеження',
    status: 'finished',
    street: 'вул. Шевченка',
  },
  {
    label: 'regime-window-2',
    startsAt: '2026-10-08T16:00:00+03:00',
    endsAt: '2026-10-08T18:00:00+03:00',
    reason: 'Заходи обмеження',
    status: 'finished',
    street: 'вул. Польова',
  },
  {
    label: 'repair-active',
    startsAt: '2026-10-09T10:00:00+03:00',
    endsAt: '2026-10-09T13:00:00+03:00',
    reason: 'Виконання ремонтних робіт',
    status: 'active',
    street: 'вул. Садова',
  },
  {
    label: 'cancelled-window',
    startsAt: '2026-10-09T15:00:00+03:00',
    endsAt: '2026-10-09T17:00:00+03:00',
    reason: 'Заходи обмеження',
    status: 'cancelled',
    street: 'вул. Лугова',
  },
  {
    label: 'emergency-open-ended',
    startsAt: '2026-10-09T07:00:00+03:00',
    endsAt: '2026-10-20T00:00:00+03:00',
    reason: 'Пошкодження мережі',
    status: 'active',
    street: 'вул. Київська',
  },
  {
    label: 'scheduled-window',
    startsAt: '2026-10-10T08:00:00+03:00',
    endsAt: '2026-10-10T10:00:00+03:00',
    reason: 'Заходи обмеження',
    status: 'scheduled',
    street: 'вул. Миру',
  },
];

export const EXPECTED_EVENTS = FIXTURE.length; // 6
export const EXPECTED_ROWS = FIXTURE.length * ADDRESSES_PER_EVENT; // 30

/** Сирі рядки оператора: кожна подія розкидана на 30/6 = 5 адрес. */
export function fixtureRows() {
  return FIXTURE.flatMap((event) =>
    Array.from({ length: ADDRESSES_PER_EVENT }, (_, index) => {
      const house = index + 1;
      const address = `${AREA}, ${event.street}, буд. ${house}`;
      return {
        sourceId: SOURCE_ID,
        startsAt: new Date(event.startsAt),
        endsAt: new Date(event.endsAt),
        areaName: AREA,
        addressesRaw: address,
        addressesNormalized: address.toLowerCase(),
        reason: event.reason,
        status: event.status,
        source: 'test-fixture',
        externalId: `fixture-${event.label}-${house}`,
        contentHash: `fixture-${event.label}-${house}`,
      };
    }),
  );
}
