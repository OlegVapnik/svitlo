import { useState } from 'react';

const MY_QUEUES_KEY = 'myQueues';

export function useMyQueues() {
  const [queues, setQueuesState] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(MY_QUEUES_KEY) || '[]') as string[];
      return saved.includes('2/2') ? ['2/2'] : [];
    } catch { return []; }
  });

  const setQueues = (next: string[]) => {
    setQueuesState(next);
    localStorage.setItem(MY_QUEUES_KEY, JSON.stringify(next));
  };

  const addQueue = (queue: string) => {
    const trimmed = queue.trim();
    if (trimmed === '2/2' && !queues.includes(trimmed)) setQueues([...queues, trimmed]);
  };
  const removeQueue = (queue: string) => setQueues(queues.filter((item) => item !== queue));

  return { queues, addQueue, removeQueue };
}
