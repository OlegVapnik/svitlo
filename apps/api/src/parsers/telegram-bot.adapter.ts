import type { ISourceAdapter, ParseResult } from './adapter.js';
import { TelegramChannelAdapter } from './telegram-channel.adapter.js';

/** Optional user-session adapter. It intentionally never runs unless TELEGRAM_BOT_ENABLED=true. */
export class TelegramBotAdapter implements ISourceAdapter {
  readonly name = 'TelegramBotAdapter';
  readonly sourceUrl = 'https://t.me/chernigivoblenergo';

  async fetch(): Promise<ParseResult> {
    const { env } = await import('../config.js');
    if (!env.TELEGRAM_BOT_ENABLED) throw new Error('Telegram user-session adapter is disabled');
    if (!env.TELEGRAM_API_ID || !env.TELEGRAM_API_HASH || !env.TELEGRAM_SESSION) {
      throw new Error('TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_SESSION are required when the optional Telegram user session is enabled');
    }
    // Deliberately no implicit MTProto login. Keep the opt-in isolated until operators
    // explicitly install/configure a compliant GramJS session and accept account risk.
    return new TelegramChannelAdapter().fetch();
  }
}
