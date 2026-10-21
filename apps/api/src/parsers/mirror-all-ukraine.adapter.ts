import { ParsedScheduleSlot, normalizeQueueCode } from './ukraine-providers.adapter.js';

export interface MirrorRegionSchedule {
  cpu: string;
  name_ua?: string;
  schedule?: Record<string, Record<string, Record<string, number | string>>>;
}

const HALF_HOUR_LABELS: string[] = Array.from({ length: 48 }, (_, idx) => {
  const hh = String(Math.floor(idx / 2)).padStart(2, '0');
  const mm = idx % 2 === 0 ? '00' : '30';
  return `${hh}:${mm}`;
});

export class AllUkraineMirrorAdapter {
  private readonly url: string;

  constructor(url = process.env.MIRROR_SCHEDULE_URL ?? 'https://dtek-api.svitlo-proxy.workers.dev/') {
    this.url = url;
  }

  async fetchAllRegionsSchedules(filterRegions?: string[]): Promise<{
    slots: ParsedScheduleSlot[];
    regions: Array<{ cpu: string; nameUa: string; queues: string[] }>;
  }> {
    const res = await fetch(this.url, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`[mirror] HTTP ${res.status} from ${this.url}`);
    }

    const raw = (await res.json()) as { body?: string; regions?: MirrorRegionSchedule[] };
    const unwrapped: { regions?: MirrorRegionSchedule[] } =
      typeof raw.body === 'string' ? JSON.parse(raw.body) : raw;

    const regionsList = Array.isArray(unwrapped.regions) ? unwrapped.regions : [];
    const slots: ParsedScheduleSlot[] = [];
    const regionsMeta: Array<{ cpu: string; nameUa: string; queues: string[] }> = [];

    for (const reg of regionsList) {
      if (!reg.cpu || !reg.schedule) continue;
      if (filterRegions && filterRegions.length > 0 && !filterRegions.includes(reg.cpu)) {
        continue;
      }

      const queues = Object.keys(reg.schedule).map(normalizeQueueCode);
      regionsMeta.push({
        cpu: reg.cpu,
        nameUa: reg.name_ua ?? reg.cpu,
        queues,
      });

      for (const [groupKey, datesMap] of Object.entries(reg.schedule)) {
        const queue = normalizeQueueCode(groupKey);
        for (const [dateStr, timesMap] of Object.entries(datesMap)) {
          slots.push(...this.mergeHalfHours(reg.cpu, queue, dateStr, timesMap));
        }
      }
    }

    return { slots, regions: regionsMeta };
  }

  private mergeHalfHours(
    regionCpu: string,
    queue: string,
    date: string,
    timesMap: Record<string, number | string>,
  ): ParsedScheduleSlot[] {
    // В зеркале: 2 = точное отключение, 3 = возможное отключение, 0/1 = свет есть
    const states: Array<0 | 2 | 3> = HALF_HOUR_LABELS.map((label) => {
      const code = Number(timesMap[label] ?? 0);
      if (code === 2) return 3; // Мапим в код 3 Svitlo ("Відключення")
      if (code === 3) return 2; // Мапим в код 2 Svitlo ("Можливе відключення")
      return 0;
    });

    const merged: ParsedScheduleSlot[] = [];
    let i = 0;
    while (i < 48) {
      const stateCode = states[i];
      if (stateCode === 0) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < 48 && states[j] === stateCode) {
        j++;
      }

      const timeFrom = HALF_HOUR_LABELS[i]!;
      const timeTo = j === 48 ? '00:00' : HALF_HOUR_LABELS[j]!;

      merged.push({
        provider: 'chernihiv',
        regionCpu,
        queue,
        date,
        timeFrom,
        timeTo,
        stateCode,
        stateName: stateCode === 3 ? 'Відключення' : 'Можливе відключення',
        stateColor: stateCode === 3 ? '#E33535' : '#F59E0B',
      });

      i = j;
    }

    return merged;
  }
}