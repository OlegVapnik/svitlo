import { load } from 'cheerio';
import type { ISourceAdapter, ParseResult } from './adapter.js';
import { env } from '../config.js';

export class ChernihivAdapter implements ISourceAdapter {
  readonly name = 'InterruptionsEnergyAdapter';
  readonly sourceUrl = env.SOURCE_URL;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) { this.fetchImpl = fetchImpl; }

  async fetch(): Promise<ParseResult> {
    if (this.sourceUrl.endsWith('.invalid/disabled')) {
      throw new Error('Автоматичне отримання даних оператора вимкнено; використовуйте лише ручний імпорт графіка.');
    }
    const response = await this.fetchImpl(this.sourceUrl, {
      headers: { 'user-agent': env.PARSER_USER_AGENT, accept: 'text/html,application/json' },
      signal: AbortSignal.timeout(env.PARSE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Primary outage source returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();
    if (contentType.includes('application/json') || /^[\s]*[\[{]/u.test(body)) {
      try { return this.parseJson(JSON.parse(body), body); } catch (error) {
        if (contentType.includes('application/json')) throw error;
      }
    }
    const $ = load(body);
    const iframeSrc = $('iframe').first().attr('src');
    if (iframeSrc) {
      const iframeUrl = new URL(iframeSrc, this.sourceUrl).toString();
      const iframeResponse = await this.fetchImpl(iframeUrl, {
        headers: { 'user-agent': env.PARSER_USER_AGENT, referer: this.sourceUrl, accept: 'text/html,application/json' },
        signal: AbortSignal.timeout(env.PARSE_TIMEOUT_MS),
      });
      if (!iframeResponse.ok) throw new Error(`Primary outage iframe returned HTTP ${iframeResponse.status}`);
      const iframeType = iframeResponse.headers.get('content-type') ?? '';
      const iframeBody = await iframeResponse.text();
      if (iframeType.includes('application/json') || /^[\\s]*[\\[{]/u.test(iframeBody)) {
        try { return this.parseJson(JSON.parse(iframeBody), JSON.stringify({ page: body, iframe: iframeBody })); }
        catch (error) { if (iframeType.includes('application/json')) throw error; }
      }
      return this.parseHtml(iframeBody, JSON.stringify({ page: body, iframe: iframeBody }));
    }
    return this.parseHtml(body, body);
  }

  private parseHtml(body: string, rawSnapshot: string): ParseResult {
    const $ = load(body);
    const outages: ParseResult['outages'] = [];
    $('[data-start], [data-starts-at], .outage, .interruption, .schedule-row, tr').each((_, element) => {
      const row = $(element);
      const text = row.text().replace(/\s+/gu, ' ').trim();
      const startsAtValue = row.attr('data-start') ?? row.attr('data-starts-at') ?? row.find('time').first().attr('datetime');
      const endsAtValue = row.attr('data-end') ?? row.attr('data-ends-at') ?? row.find('time').eq(1).attr('datetime');
      const startsAt = startsAtValue ? new Date(startsAtValue) : null;
      const endsAt = endsAtValue ? new Date(endsAtValue) : null;
      if (!startsAt || !endsAt || Number.isNaN(+startsAt) || Number.isNaN(+endsAt) || !text) return;
      const areaName = row.attr('data-area') ?? row.find('[data-area], .area, .district').first().text().trim() ?? 'Чернігівська область';
      const queueValue = row.attr('data-queue') ?? text.match(/(?:черга|група)\s*([1-6])/iu)?.[1];
      outages.push({ startsAt, endsAt, areaName: areaName || 'Чернігівська область', addressesRaw: text, reason: text, queue: queueValue ? Number(queueValue) : null });
    });
    return { outages, incidents: [], gridLevel: 'stable', gridMessage: '', rawSnapshot };
  }

  private parseJson(payload: unknown, rawSnapshot: string): ParseResult {
    const root = payload as Record<string, unknown>;
    const items = Array.isArray(payload) ? payload : [root['data'], root['outages'], root['items']].find(Array.isArray) ?? [];
    const outages: ParseResult['outages'] = (items as Array<Record<string, unknown>>).flatMap((item) => {
      const startsAt = new Date(String(item['startsAt'] ?? item['starts_at'] ?? item['start'] ?? ''));
      const endsAt = new Date(String(item['endsAt'] ?? item['ends_at'] ?? item['end'] ?? ''));
      if (Number.isNaN(+startsAt) || Number.isNaN(+endsAt)) return [];
      return [{ startsAt, endsAt, areaName: String(item['areaName'] ?? item['area'] ?? item['district'] ?? 'Чернігівська область'), addressesRaw: String(item['addresses'] ?? item['address'] ?? item['name'] ?? ''), reason: item['reason'] == null ? null : String(item['reason']), queue: item['queue'] == null ? null : Number(item['queue']), externalId: item['id'] == null ? undefined : String(item['id']), sourceUrl: this.sourceUrl }];
    });
    return { outages, incidents: [], gridLevel: 'stable', gridMessage: '', rawSnapshot };
  }
}
