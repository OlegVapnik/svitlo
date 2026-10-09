import { load } from 'cheerio';
import type { ISourceAdapter, ParseResult } from './adapter.js';
import { shouldKeepRegionalIncident, shouldShowIncident } from '../services/outage-classification.js';

export type TelegramPost = { id: string; text: string; date: Date; link: string; kind: TelegramPostKind };
export type TelegramPostKind = 'outage_schedule' | 'incident' | 'news';

export const TELEGRAM_RULES = {
  outageSchedule: /графік(?:и)?\s+(?:погодинн(?:их|і)|відключень)|черг(?:а|і)\s*\d|відключенн.{0,30}(?:з\s+\d{1,2}[:.]\d{2}|з\s+\d{1,2}\s*(?:до|по))/iu,
  incident: /аварійн.{0,25}(?:відключ|знеструм|пошкод)|знеструмлено|відновленн.{0,25}(?:електропостачан|електроенерг)|без\s+світла|виконання\s+ремонтних\s+робіт/iu,
};

export function classifyTelegramText(text: string): TelegramPostKind {
  if (TELEGRAM_RULES.outageSchedule.test(text)) return 'outage_schedule';
  if (TELEGRAM_RULES.incident.test(text)) return 'incident';
  return 'news';
}

export class TelegramChannelAdapter implements ISourceAdapter {
  readonly name = 'TelegramChannelAdapter';
  readonly sourceUrl = 'https://t.me/s/chernigivoblenergo';
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) { this.fetchImpl = fetchImpl; }

  async fetchPosts(): Promise<{ posts: TelegramPost[]; rawSnapshot: string }> {
    const response = await this.fetchImpl(this.sourceUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 EnergyMonitor/1.0', accept: 'text/html' },
      signal: AbortSignal.timeout(Number(process.env['PARSE_TIMEOUT_MS'] ?? 30000)),
    });
    if (!response.ok) throw new Error(`Telegram channel returned HTTP ${response.status}`);
    const html = await response.text();
    const $ = load(html);
    const posts: TelegramPost[] = [];
    $('.tgme_widget_message').each((_, element) => {
      const message = $(element);
      const id = message.attr('data-post')?.split('/').pop();
      const text = message.find('.tgme_widget_message_text').text().replace(/\s+/gu, ' ').trim();
      const dateText = message.find('time[datetime]').attr('datetime');
      const date = dateText ? new Date(dateText) : null;
      const link = message.find('.tgme_widget_message_date').attr('href') ?? (id ? `https://t.me/chernigivoblenergo/${id}` : '');
      if (!id || !text || !date || Number.isNaN(date.getTime())) return;
      posts.push({ id, text, date, link, kind: classifyTelegramText(text) });
    });
    return { posts, rawSnapshot: html };
  }

  async fetch(): Promise<ParseResult> {
    const { posts, rawSnapshot } = await this.fetchPosts();
    const incidents = posts
      .filter((post) => classifyTelegramText(post.text) === 'incident')
      .filter((post) => shouldShowIncident(post.text))
      .filter((post) => shouldKeepRegionalIncident(post.text, post.text))
      .map((post) => ({
        title: `Повідомлення Telegram: ${post.text.slice(0, 120)}`,
        description: `${post.text}\n${post.link}`,
        startedAt: post.date,
        etaAt: null,
        severity: 'medium' as const,
        externalId: post.id,
        sourceUrl: post.link,
      }));
    return {
      outages: [],
      incidents,
      gridLevel: 'stable',
      gridMessage: '',
      rawSnapshot,
      posts,
    };
  }
}
