import { z } from 'zod';
import type { OperatorInterval, OperatorScheduleResponse, ScheduleIntervalUtc, OperatorStateCode } from '@energy-monitor/shared';
import { getOperatorState, scheduleImportRequestSchema } from '@energy-monitor/shared';
/**
 * Нормализация ответа оператора в UTC-интервалы.
 * Зона источника — Europe/Kyiv; time_to "00:00" трактуется как 24:00 того же дня.
 */

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour! * 60 + minute!;
}

export function kyivOffsetMinutes(dateYMD: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${dateYMD}T12:00:00Z`)).find((item) => item.type === 'timeZoneName')?.value ?? 'GMT+2';
  return part.endsWith('+3') ? 180 : 120;
}

function zonedDateTimeToUtc(dateYMD: string, time: string): Date {
  const [year, month, day] = dateYMD.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  // Resolve wall time against IANA rules. Repeat for the rare offset change near transitions.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']), Number(parts['hour']), Number(parts['minute']));
    const delta = target - represented;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

function addCalendarDays(date: string, amount: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function normalizeScheduleResponse(response: OperatorScheduleResponse, dateYMD: string): ScheduleIntervalUtc[] {
  const states = response.aState;
  const expanded = response.aData.map((slot: OperatorInterval) => {
    const startMin = minutes(slot.time_from);
    const endMin = slot.time_to === '00:00' ? 24 * 60 : minutes(slot.time_to);
    if (slot.time_to !== '00:00' && endMin <= startMin) throw new Error('Час завершення інтервалу має бути після початку');
    const state = getOperatorState(states, slot.queue);
    return {
      startMin,
      endMin,
      stateCode: slot.queue as OperatorStateCode,
      stateName: state?.name ?? String(slot.queue),
      stateColor: state?.color ?? '#AFAFAF',
    };
  });

  // Склейка соседних интервалов одного кода.
  const merged: Array<typeof expanded[number]> = [];
  for (const slot of expanded) {
    const prev = merged[merged.length - 1];
    if (prev && prev.stateCode === slot.stateCode && prev.endMin === slot.startMin) prev.endMin = slot.endMin;
    else merged.push({ ...slot });
  }

  return merged.map((slot) => {
    const startYmd = addCalendarDays(dateYMD, Math.floor(slot.startMin / 1440));
    const startTime = `${String(Math.floor((slot.startMin % 1440) / 60)).padStart(2, '0')}:${String(slot.startMin % 60).padStart(2, '0')}`;
    const endYmd = addCalendarDays(dateYMD, Math.floor(slot.endMin / 1440));
    const endTime = `${String(Math.floor((slot.endMin % 1440) / 60)).padStart(2, '0')}:${String(slot.endMin % 60).padStart(2, '0')}`;
    return {
      startsAt: zonedDateTimeToUtc(startYmd, startTime).toISOString(),
      endsAt: zonedDateTimeToUtc(endYmd, endTime).toISOString(),
      stateCode: slot.stateCode,
      stateName: slot.stateName,
      stateColor: slot.stateColor,
    };
  });
}
