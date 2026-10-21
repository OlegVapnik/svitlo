import type { Incident } from '@svitlo/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { incidents, outageEventAddresses, outageEvents } from '../db/schema.js';
import { isRegimeNotice, shouldShowIncident } from './outage-classification.js';
import { extractIncidentDetails } from './incident-details.js';
import { outageIncidentState, severityForState, type IncidentState } from './incident-status.js';
import { summarizeAffectedAddresses } from './outage-grouping.js';

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

/** Категорії, які показуємо як «Аварії та ремонтні роботи»: фізичне пошкодження і ремонт. */
const INCIDENT_CATEGORIES = ['emergency', 'repair'];

/**
 * Стан події з відкритим кінцем (ends_at = NULL): якщо вона вже почалась — вона триває, і «усуненою»
 * її оголошувати не можна. Дату завершення ми не вигадуємо, тому окремо від outageIncidentState().
 */
function stateForEvent(startsAt: Date, endsAt: Date | null, now: Date): IncidentState {
  if (endsAt) return outageIncidentState(startsAt, endsAt, now);
  return startsAt.getTime() > now.getTime() ? 'scheduled' : 'active';
}

/** Єдине джерело списку «Аварії та ремонтні роботи» (використовують і сторінка, і /status). */
export async function getIncidents(now: Date = new Date()): Promise<Incident[]> {
  // Проекція КАНОНІЧНИХ подій (invariant 5 у outage-data-core): аварія/ремонт — це подія, а не 30
  // адресних рядків. Режимні/планові вікна (ГАВ, погодинні графіки) сюди не входять: у них немає ні
  // конкретного місця, ні причини — вони лишаються на сторінці «Відключення». Адреси беремо з
  // outage_event_addresses і стискаємо до вулиць тим самим summarizeAffectedAddresses, що й раніше.
  const [storedRows, eventRows] = await Promise.all([
    db.select().from(incidents),
    db
      .select({
        id: outageEvents.id,
        category: outageEvents.category,
        reason: outageEvents.reason,
        areaName: outageEvents.areaName,
        startsAt: outageEvents.startsAt,
        endsAt: outageEvents.endsAt,
        externalId: outageEvents.externalId,
        addresses: sql<string[]>`coalesce(array_agg(distinct ${outageEventAddresses.addressRaw}), '{}')`,
      })
      .from(outageEvents)
      .leftJoin(outageEventAddresses, eq(outageEventAddresses.eventId, outageEvents.id))
      .where(and(isNull(outageEvents.cancelledAt), inArray(outageEvents.category, INCIDENT_CATEGORIES)))
      .groupBy(outageEvents.id)
      .orderBy(desc(outageEvents.startsAt)),
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

  // Одна подія = одна картка «Аварії та ремонтні роботи».
  const outageIncidents = eventRows
    .filter((event) => !(event.externalId && storedExternalIds.has(event.externalId)))
    .map<Incident>((event) => {
      const state = stateForEvent(event.startsAt, event.endsAt, now);
      const addressesText = summarizeAffectedAddresses(event.addresses ?? []);
      const details = extractIncidentDetails(`${event.reason ?? ''} ${addressesText}`);
      return {
        id: `outage-${event.id}`,
        title: event.reason ?? 'Планові ремонтні роботи',
        description: `${event.areaName ?? ''} · ${addressesText}`.replace(/^ · /u, ''),
        startedAt: event.startsAt.toISOString(),
        etaAt: event.endsAt?.toISOString() ?? null,
        severity: severityForState(state),
        status: state,
        kind: 'outage',
        areaName: event.areaName || details.area,
        reason: event.reason ?? details.cause,
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
