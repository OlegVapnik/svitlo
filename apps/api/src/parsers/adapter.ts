export interface ParseResult {
  outages: NormalizedOutage[];
  incidents: NormalizedIncident[];
  gridLevel: 'stable' | 'warning' | 'emergency';
  gridMessage: string;
  rawSnapshot: string;
  /** False when one or more configured portions of the operator feed failed to load. */
  complete?: boolean;
  /** Completeness is tracked per configured portion so cancellation can exclude failed portions. */
  completeScopeKeys?: string[];
  posts?: Array<{ id: string; text: string; date: Date; link: string; kind: 'outage_schedule' | 'incident' | 'news' }>;
}

export interface NormalizedOutage {
  startsAt: Date;
  endsAt: Date;
  areaName: string;
  addressesRaw: string;
  reason: string | null;
  queue: number | null;
  externalId?: string;
  sourceUrl?: string;
}

export interface NormalizedIncident {
  title: string;
  description: string;
  startedAt: Date;
  etaAt: Date | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  externalId?: string;
  sourceUrl?: string;
}

export interface ISourceAdapter {
  readonly name: string;
  readonly sourceUrl: string;
  fetch(): Promise<ParseResult>;
}
