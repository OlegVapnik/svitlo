import type { ScheduleIntervalUtc } from '@svitlo/shared';
import { kyivOffset, minutesOfDay, minutesToHm, OFF_STATE_CODE } from './scheduleWindow';

export interface TimelineSlot {
  /** Індекс півгодинного слота (0..47). */
  index: number;
  /** Година (0..23). */
  hour: number;
  /** Хвилина початку (0 або 30). */
  minute: number;
  /** Хвилина початку від 00:00 (0..1410). */
  startMinutes: number;
  /** Хвилина кінця від 00:00 (30..1440). */
  endMinutes: number;
  /** Підпис часу (наприклад, '14:30'). */
  timeLabel: string;
  /** Діапазон часу (наприклад, '14:30–15:00'). */
  rangeLabel: string;
  /** Код стану: 3 — відключення, 2 — можливе відключення, 1 — світло є, null — немає даних. */
  stateCode: number | null;
  /** Назва стану (з графіка або 'Даних немає'). */
  stateName: string;
  /** Колір стану (hex або null). */
  stateColor: string | null;
  /** Чи припадає поточний час (зараз) на цей слот. */
  isCurrent: boolean;
  /** Чи цей слот уже в минулому (для поточної доби). */
  isPast: boolean;
}

export interface HourSummary {
  hour: number;
  label: string;
  slots: [TimelineSlot, TimelineSlot];
  hasOff: boolean;
  allOff: boolean;
  isCurrent: boolean;
  ariaAnnouncement: string;
}

export interface CurrentTimeMarker {
  nowMinutes: number;
  percent: number;
  timeFormatted: string;
}

/** Формує підпис години у форматі HH:00. */
export function formatHour(hour: number): string {
  return `${String(Math.max(0, Math.min(23, hour))).padStart(2, '0')}:00`;
}

/** Обмежує номер години діапазоном 0..23 для клавіатурної навігації. */
export function clampHour(hour: number): number {
  if (hour < 0) return 0;
  if (hour > 23) return 23;
  return Math.floor(hour);
}

/**
 * Перевіряє, чи обрана дата є поточною добою за київським часом,
 * і повертає поточну хвилину доби (0..1440).
 */
export function getKyivNowMinutes(date: string, now: Date = new Date()): number | null {
  const dayStartUtcMs = Date.parse(`${date}T00:00:00Z`) - kyivOffset(date) * 60_000;
  const isChosenDay = now.getTime() >= dayStartUtcMs && now.getTime() < dayStartUtcMs + 24 * 60 * 60_000;
  if (!isChosenDay) return null;
  const minutes = (now.getTime() - dayStartUtcMs) / 60_000;
  return Math.max(0, Math.min(1440, Math.round(minutes)));
}

/**
 * Повертає положення маркера поточного часу на шкалі 0..100%,
 * або null, якщо переглядається не поточна доба.
 */
export function getCurrentTimeMarker(date: string, now: Date = new Date()): CurrentTimeMarker | null {
  const nowMinutes = getKyivNowMinutes(date, now);
  if (nowMinutes == null) return null;

  const percent = Math.max(0, Math.min(100, (nowMinutes / 1440) * 100));
  const timeFormatted = minutesToHm(nowMinutes);
  return { nowMinutes, percent, timeFormatted };
}

/**
 * Генерує 48 півгодинних слотів для доби 00:00–24:00 на основі інтервалів графіка.
 * Інтервали черги вирівняні по :00/:30 у київському часі.
 */
export function generateTimelineSlots(
  intervals: ScheduleIntervalUtc[],
  date: string,
  now: Date = new Date(),
): TimelineSlot[] {
  const nowMinutes = getKyivNowMinutes(date, now);
  const slots: TimelineSlot[] = [];

  // Перетворюємо інтервали у хвилини доби один раз для швидкості
  const mappedIntervals = intervals.map((interval) => ({
    from: minutesOfDay(interval.startsAt, date),
    to: minutesOfDay(interval.endsAt, date),
    stateCode: interval.stateCode,
    stateName: interval.stateName,
    stateColor: interval.stateColor,
  }));

  for (let index = 0; index < 48; index++) {
    const hour = Math.floor(index / 2);
    const minute = (index % 2) * 30;
    const startMinutes = index * 30;
    const endMinutes = (index + 1) * 30;
    const timeLabel = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const nextHour = Math.floor(endMinutes / 60);
    const nextMinute = endMinutes % 60;
    const endLabel = `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
    const rangeLabel = `${timeLabel}–${endLabel}`;

    const midMinute = startMinutes + 15;
    // Шукаємо інтервал, що перетинає середину слота
    const match = mappedIntervals.find(
      (item) => item.from <= midMinute && midMinute < item.to,
    );

    const stateCode = match ? match.stateCode : intervals.length > 0 ? 1 : null;
    const stateName = match
      ? match.stateName
      : intervals.length > 0
        ? 'Світло є'
        : 'Даних немає';
    const stateColor = match ? match.stateColor : null;

    const isCurrent =
      nowMinutes != null && nowMinutes >= startMinutes && nowMinutes < endMinutes;
    const isPast = nowMinutes != null && nowMinutes >= endMinutes;

    slots.push({
      index,
      hour,
      minute,
      startMinutes,
      endMinutes,
      timeLabel,
      rangeLabel,
      stateCode,
      stateName,
      stateColor,
      isCurrent,
      isPast,
    });
  }

  return slots;
}

/**
 * Повертає зведення для конкретної години (0..23) з 2 півгодинних слотів
 * та формує доступне голосове повідомлення для aria-live.
 */
export function getHourSummary(
  slots: TimelineSlot[],
  hour: number,
  t?: (key: string, options?: Record<string, unknown>) => string,
): HourSummary {
  const safeHour = clampHour(hour);
  const slot1 = slots[safeHour * 2] ?? slots[0]!;
  const slot2 = slots[safeHour * 2 + 1] ?? slots[1]!;

  const hasOff = slot1.stateCode === OFF_STATE_CODE || slot2.stateCode === OFF_STATE_CODE;
  const allOff = slot1.stateCode === OFF_STATE_CODE && slot2.stateCode === OFF_STATE_CODE;
  const isCurrent = slot1.isCurrent || slot2.isCurrent;

  const hourStart = formatHour(safeHour);
  const hourEnd = formatHour(safeHour + 1);
  const label = `${hourStart}–${hourEnd}`;

  let ariaAnnouncement = `${label}: `;
  if (slot1.stateCode == null && slot2.stateCode == null) {
    ariaAnnouncement += t ? t('timeline.noDataHour') : 'Даних немає';
  } else if (allOff) {
    ariaAnnouncement += t ? t('timeline.fullOffHour') : 'Відключення протягом усієї години';
  } else if (!hasOff && slot1.stateCode === 1 && slot2.stateCode === 1) {
    ariaAnnouncement += t ? t('timeline.fullOnHour') : 'Світло є протягом усієї години';
  } else {
    ariaAnnouncement += `${slot1.timeLabel} (${slot1.stateName}), ${slot2.timeLabel} (${slot2.stateName})`;
  }

  if (isCurrent) {
    ariaAnnouncement += t ? ` (${t('schedule.now')})` : ' (Зараз)';
  }

  return {
    hour: safeHour,
    label,
    slots: [slot1, slot2],
    hasOff,
    allOff,
    isCurrent,
    ariaAnnouncement,
  };
}
