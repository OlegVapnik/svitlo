/**
 * Валідатор якості даних розкладів (ГПВ) для multi-region Svitlo.
 *
 * Чистий модуль (без обов'язкового підключення до БД чи мережі), перевіряє інтервали
 * розкладу перед записом у `schedule_slots`:
 * 1. Пустий набір слотів
 * 2. Невідповідність дати (або некоректний формат дати YYYY-MM-DD)
 * 3. Дата з минулого (раніше за поточну добу в Europe/Kyiv)
 * 4. Неприпустимий код стану (поза 1..3)
 * 5. Некоректний діапазон часу (timeTo <= timeFrom)
 * 6. Дублікати слотів (однакові queue + date + timeFrom)
 * 7. Перетин інтервалів для однієї черги та дати
 * 8. Більше 12 годин відключень на одну чергу за добу
 */

export interface ScheduleSlotCandidate {
  queue: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  stateCode: number;
  stateName?: string;
  stateColor?: string;
  region?: string;
}

export interface ValidationContext {
  /** Очікувана дата (якщо перевіряється конкретний день). */
  expectedDate?: string;
  /** Дозволити дати з минулого (типово false: графіки минулих днів не приймаємо). */
  allowPastDates?: boolean;
  /** Момент часу для порівняння (типово поточний час). */
  now?: Date;
  /** Максимальна сумарна тривалість відключень на чергу за добу в годинах (типово 12). */
  maxOutageHoursPerDay?: number;
  /** Ідентифікатор області для контексту логів/помилок. */
  regionCpu?: string;
  /** Джерело даних (mirror, loe, etc.). */
  sourceKey?: string;
}

export type SlotRejectionCode =
  | 'EMPTY_SET'
  | 'DATE_MISMATCH'
  | 'PAST_DATE'
  | 'INVALID_STATE_CODE'
  | 'INVALID_TIME_RANGE'
  | 'DUPLICATE_SLOT'
  | 'OVERLAPPING_INTERVALS'
  | 'EXCESSIVE_OUTAGE_DURATION';

export interface SlotRejection<T extends ScheduleSlotCandidate = ScheduleSlotCandidate> {
  slot: T;
  code: SlotRejectionCode;
  reason: string;
}

export interface ScheduleValidationResult<T extends ScheduleSlotCandidate = ScheduleSlotCandidate> {
  valid: boolean;
  accepted: T[];
  rejected: Array<SlotRejection<T>>;
  errors: string[];
}

/**
 * Перетворює "HH:MM" у хвилини від початку доби (0..1440).
 * Для кінця інтервалу "00:00" та "24:00" означають 1440 (кінець доби).
 */
export function timeToMinutes(time: string, isEnd = false): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    if (isEnd && time.trim() === '24:00') return 1440;
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (isEnd && hours === 0 && minutes === 0) {
    return 1440;
  }
  return hours * 60 + minutes;
}

/**
 * Валідує масив слотів розкладу.
 * Повертає відфільтровані валідні слоти (accepted) та відхилені слоти (rejected) з причинами.
 */
export function validateScheduleSlots<T extends ScheduleSlotCandidate>(
  slots: T[],
  ctx: ValidationContext = {},
): ScheduleValidationResult<T> {
  if (!Array.isArray(slots) || slots.length === 0) {
    return {
      valid: false,
      accepted: [],
      rejected: [],
      errors: ['EMPTY_SET: Порожній набір слотів — немає даних для імпорту'],
    };
  }

  const now = ctx.now ?? new Date();
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const maxOutageMinutes = (ctx.maxOutageHoursPerDay ?? 12) * 60;
  const accepted: T[] = [];
  const rejected: Array<SlotRejection<T>> = [];
  const errors: string[] = [];

  // Етап 1: Індивідуальна перевірка кожного слота
  const passedIndividual: Array<{ slot: T; startMin: number; endMin: number }> = [];
  const seenSlotKeys = new Set<string>();

  for (const slot of slots) {
    // 1. Код стану
    if (!Number.isInteger(slot.stateCode) || ![1, 2, 3].includes(slot.stateCode)) {
      rejected.push({
        slot,
        code: 'INVALID_STATE_CODE',
        reason: `Неприпустимий код стану: ${slot.stateCode} (очікується 1, 2 або 3)`,
      });
      continue;
    }

    // 2. Формат дати
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) {
      rejected.push({
        slot,
        code: 'DATE_MISMATCH',
        reason: `Некоректний формат дати: "${slot.date}", очікується YYYY-MM-DD`,
      });
      continue;
    }

    // 3. Очікувана дата (якщо передана)
    if (ctx.expectedDate && slot.date !== ctx.expectedDate) {
      rejected.push({
        slot,
        code: 'DATE_MISMATCH',
        reason: `Невідповідність дати: отримана "${slot.date}", очікувалася "${ctx.expectedDate}"`,
      });
      continue;
    }

    // 4. Дата з минулого
    if (!ctx.allowPastDates && slot.date < todayYmd) {
      rejected.push({
        slot,
        code: 'PAST_DATE',
        reason: `Дата з минулого: "${slot.date}" раніше за поточну добу "${todayYmd}"`,
      });
      continue;
    }

    // 5. Коректність часу
    const startMin = timeToMinutes(slot.timeFrom, false);
    const endMin = timeToMinutes(slot.timeTo, true);
    if (startMin === null || endMin === null || endMin <= startMin) {
      rejected.push({
        slot,
        code: 'INVALID_TIME_RANGE',
        reason: `Некоректний діапазон часу: ${slot.timeFrom} - ${slot.timeTo}`,
      });
      continue;
    }

    // 6. Дублікати слотів (черга + дата + початок)
    const slotKey = `${slot.queue}|${slot.date}|${slot.timeFrom}`;
    if (seenSlotKeys.has(slotKey)) {
      rejected.push({
        slot,
        code: 'DUPLICATE_SLOT',
        reason: `Дублікат слота: черга ${slot.queue}, дата ${slot.date}, початок ${slot.timeFrom}`,
      });
      continue;
    }
    seenSlotKeys.add(slotKey);

    passedIndividual.push({ slot, startMin, endMin });
  }

  // Етап 2: Перевірка інтервалів та тривалості по кожній групі (черга + дата)
  const byQueueAndDate = new Map<string, Array<{ slot: T; startMin: number; endMin: number }>>();
  for (const item of passedIndividual) {
    const groupKey = `${item.slot.queue}|${item.slot.date}`;
    const list = byQueueAndDate.get(groupKey) ?? [];
    list.push(item);
    byQueueAndDate.set(groupKey, list);
  }

  for (const [groupKey, groupItems] of byQueueAndDate.entries()) {
    // Сортуємо інтервали за часом початку
    groupItems.sort((a, b) => a.startMin - b.startMin);

    // 7. Перевірка на перетин інтервалів
    let hasOverlap = false;
    for (let i = 0; i < groupItems.length - 1; i += 1) {
      const current = groupItems[i]!;
      const next = groupItems[i + 1]!;
      if (current.endMin > next.startMin) {
        hasOverlap = true;
        break;
      }
    }

    if (hasOverlap) {
      for (const item of groupItems) {
        rejected.push({
          slot: item.slot,
          code: 'OVERLAPPING_INTERVALS',
          reason: `Перетин інтервалів для черги ${item.slot.queue} на дату ${item.slot.date}`,
        });
      }
      continue;
    }

    // 8. Перевірка на максимальну тривалість відключень за добу (> 12 год)
    // Відключення — це коди стану 2 або 3 (код 1 — світло є)
    let totalOutageMinutes = 0;
    for (const item of groupItems) {
      if (item.slot.stateCode === 2 || item.slot.stateCode === 3) {
        totalOutageMinutes += item.endMin - item.startMin;
      }
    }

    if (totalOutageMinutes > maxOutageMinutes) {
      const hours = (totalOutageMinutes / 60).toFixed(1);
      for (const item of groupItems) {
        rejected.push({
          slot: item.slot,
          code: 'EXCESSIVE_OUTAGE_DURATION',
          reason: `Перевищено ліміт відключень (${hours} год > ${ctx.maxOutageHoursPerDay ?? 12} год) для черги ${item.slot.queue} на дату ${item.slot.date}`,
        });
      }
      continue;
    }

    // Всі перевірки пройдено — слоти приймаються
    for (const item of groupItems) {
      accepted.push(item.slot);
    }
  }

  if (rejected.length > 0) {
    errors.push(`Відхилено ${rejected.length} з ${slots.length} слотів розкладу`);
  }

  return {
    valid: rejected.length === 0 && accepted.length > 0,
    accepted,
    rejected,
    errors,
  };
}
