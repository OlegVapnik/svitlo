import type { Incident } from '@energy-monitor/shared';
import { db } from '../db/connection.js';
import { incidents, outages } from '../db/schema.js';
import { isOutageIncident, isRegimeNotice, shouldShowIncident } from './outage-classification.js';
import { extractIncidentDetails } from './incident-details.js';
import { outageIncidentState, severityForState } from './incident-status.js';
import { mergeDuplicateOutages } from './outage-grouping.js';

/** Порядок виводу: триваючі, далі заплановані (найближчі зверху), далі усунені (свіжіші зверху). */
const ORDER: Record<string, number> = { active: 0, scheduled: 1, resolved: 2 };

/**
 * Стан збереженого повідомлення. Якщо є орієнтовний час завершення — виводимо стан із
 * нього, щоб «усунено» ніколи не показувалось для майбутньої дати (в майбутнє «усунення»
 * не заглядає; майбутні події — лише у графіках відключень).
 */
export function storedIncidentState(status: string, etaAt: Date | null, now: Date): string {
  if (!etaAt) return status;
  return etaAt.getTime() > now.getTime() ? 'scheduled' : 'resolved';
}

/** Єдине джерело списку «Аварії та ремонтні роботи» (використовують і сторінка, і /status). */
export async function getIncidents(now: Date = new Date()): Promise<Incident[]> {
  const [storedRows, outageRows] = await Promise.all([
    db.select().from(incidents),
    db.select().from(outages),
  ]);

  // Повідомлення (Telegram / новини). Повідомлення про режим/графіки (ГАВ) — не аварії.
  const storedIncidents = storedRows
    .filter((incident) => {
      const text = `${incident.title} ${incident.description}`;
      return shouldShowIncident(text) && !isRegimeNotice(text);
    })
    .map<Incident>((incident) => {
      const details = extractIncidentDetails(`${incident.title} ${incident.description}`);
      return {
        id: incident.id,
        title: incident.title,
        description: incident.description,
        startedAt: incident.startedAt.toISOString(),
        etaAt: incident.etaAt?.toISOString() ?? null,
        severity: incident.severity,
        status: storedIncidentState(incident.status, incident.etaAt, now),
        kind: 'report',
        areaName: details.area,
        reason: details.cause,
        sourceUrl: incident.sourceUrl ?? null,
      };
    });

  const storedExternalIds = new Set(storedRows.map((incident) => incident.externalId).filter(Boolean));

  // Аварійні/ремонтні відключення оператора. Спершу згортаємо дублікати за адресами
  // (село вимикають цілком) — одна подія = одна картка.
  const outageIncidents = mergeDuplicateOutages(
    outageRows.filter((outage) => isOutageIncident(outage.reason) && !(outage.externalId && storedExternalIds.has(outage.externalId))),
  ).map<Incident>((outage) => {
    const state = outageIncidentState(outage.startsAt, outage.endsAt, now);
    const details = extractIncidentDetails(`${outage.reason ?? ''} ${outage.addressesRaw}`);
    return {
      id: `outage-${outage.id}`,
      title: outage.reason ?? 'Планові ремонтні роботи',
      description: `${outage.areaName} · ${outage.addressesRaw}`,
      startedAt: outage.startsAt.toISOString(),
      etaAt: outage.endsAt.toISOString(),
      severity: severityForState(state),
      status: state,
      kind: 'outage',
      areaName: outage.areaName || details.area,
      reason: outage.reason ?? details.cause,
      sourceUrl: null,
    };
  });

  return [...outageIncidents, ...storedIncidents].sort((a, b) => {
    const orderA = ORDER[a.status] ?? 3;
    const orderB = ORDER[b.status] ?? 3;
    if (orderA !== orderB) return orderA - orderB;
    const timeA = new Date(a.startedAt).getTime();
    const timeB = new Date(b.startedAt).getTime();
    return orderA === 1 ? timeA - timeB : timeB - timeA;
  });
}
