import { useState } from 'react';
import { isQueueCode, normalizeQueueCode, sanitizeQueueList } from '../lib/queue.js';

const MY_QUEUES_KEY = 'myQueues';

/**
 * Мои очереди. Раньше хук принимал РОВНО один код ('2/2' был зашит и в чтение, и в addQueue),
 * поэтому житель любой другой очереди ничего не мог добавить. Теперь хранится любой код вида
 * «3» или «2/2»: список локальный (localStorage), а содержимое проверяется тем же форматом, что API.
 * При чтении значения фильтруются (sanitizeQueueList) — мусор старых версий не всплывает.
 */
export function useMyQueues() {
  const [queues, setQueuesState] = useState<string[]>(() => {
    try {
      return sanitizeQueueList(JSON.parse(localStorage.getItem(MY_QUEUES_KEY) || '[]') as unknown[]);
    } catch { return []; }
  });

  const setQueues = (next: string[]) => {
    const clean = sanitizeQueueList(next);
    setQueuesState(clean);
    localStorage.setItem(MY_QUEUES_KEY, JSON.stringify(clean));
  };

  const addQueue = (queue: string) => {
    const code = normalizeQueueCode(queue);
    if (isQueueCode(code) && !queues.includes(code)) setQueues([...queues, code]);
  };
  const removeQueue = (queue: string) => setQueues(queues.filter((item) => item !== queue));

  return { queues, addQueue, removeQueue, setQueues };
}
