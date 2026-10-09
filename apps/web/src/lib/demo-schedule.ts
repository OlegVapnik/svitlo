// Demo schedule payload for queues 1/1 through 6/2; synthetic values only.
export const DEMO_OPERATOR_SCHEDULE = {
  status: 'ok',
  aData: [
    { time_from: '00:00', time_to: '06:00', queue: 1 },
    { time_from: '06:00', time_to: '07:00', queue: 2 },
    { time_from: '07:00', time_to: '10:00', queue: 3 },
    { time_from: '10:00', time_to: '10:30', queue: 2 },
    { time_from: '10:30', time_to: '16:30', queue: 1 },
    { time_from: '16:30', time_to: '17:00', queue: 2 },
    { time_from: '17:00', time_to: '20:00', queue: 3 },
    { time_from: '20:00', time_to: '20:30', queue: 2 },
    { time_from: '20:30', time_to: '00:00', queue: 1 },
  ],
  aState: {
    '1': { name: 'Світло є — демо', color: '#63AA18' },
    '2': { name: 'Розмін черги/підчерги — демо', color: '#AFAFAF' },
    '3': { name: 'Відключення — демо', color: '#E33535' },
  },
} as const;

export const DEMO_QUEUES = ['1/1','1/2','2/1','2/2','3/1','3/2','4/1','4/2','5/1','5/2','6/1','6/2'] as const;
