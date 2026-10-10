import type { OperatorScheduleResponse } from '@svitlo/shared';

/** Демо-схема для очередей 1/1–6/2. Значения синтетические, источник всегда маркируется demo. */
const DEMO_STATES = {
  '1': { name: 'Світло є (демо)', color: '#63AA18' },
  '2': { name: 'Розмін черги/підчерги — демо', color: '#AFAFAF' },
  '3': { name: 'Відключення (демо)', color: '#E33535' },
} satisfies OperatorScheduleResponse['aState'];

const pattern = [
  { time_from: '00:00', time_to: '06:00', queue: 1 },
  { time_from: '06:00', time_to: '07:00', queue: 2 },
  { time_from: '07:00', time_to: '10:00', queue: 3 },
  { time_from: '10:00', time_to: '10:30', queue: 2 },
  { time_from: '10:30', time_to: '16:30', queue: 1 },
  { time_from: '16:30', time_to: '17:00', queue: 2 },
  { time_from: '17:00', time_to: '20:00', queue: 3 },
  { time_from: '20:00', time_to: '20:30', queue: 2 },
  { time_from: '20:30', time_to: '00:00', queue: 1 },
] as const;

const queues = Array.from({ length: 12 }, (_, index) => `${Math.floor(index / 2) + 1}/${(index % 2) + 1}`);

export const DEMO_SCHEDULES: Record<string, OperatorScheduleResponse> = Object.fromEntries(
  queues.map((queue, index) => [queue, {
    status: 'ok',
    aData: pattern.map((slot, slotIndex) => ({
      ...slot,
      queue: slot.queue === 3 && (index + slotIndex) % 3 === 0 ? 2 : slot.queue,
    })),
    aState: DEMO_STATES,
  }]),
);

export const DEMO_QUEUE_NAMES = queues;
export const DEMO_QUEUES = queues;
export const DEMO_OPERATOR_SCHEDULE: OperatorScheduleResponse = DEMO_SCHEDULES['1/1']!;

/** Один и тот же синтетический график для любой очереди — только для локальной демонстрации UI. */
export function demoScheduleForQueue(queue: string): OperatorScheduleResponse | null {
  return DEMO_SCHEDULES[queue] ?? null;
}
