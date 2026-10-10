import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  ADMIN_TOKEN: z.string().default('development-admin-token'),
  // Мінімум 30 хвилин — вимога skills/scraper-adapter-hardening: оператор сидить за WAF, і часті
  // автоматичні запити виглядають як бот. Менше значення — помилка конфігурації на старті,
  // а не «легше» опитування: лікується паузою circuit breaker, а не частими запитами.
  PARSE_INTERVAL_MINUTES: z.coerce.number().int().min(30).default(60),
  // Джиттер (хвилини), що зсуває момент запиту, щоб не бити рівно по розкладу (анти-бот).
  // Мусить бути меншим за інтервал, інакше запуск напливає на наступний слот — перевірка нижче.
  PARSE_INTERVAL_JITTER_MINUTES: z.coerce.number().min(0).default(5),
  PARSE_TIMEOUT_MS: z.coerce.number().default(30000),
  // Каталог сырых ответов оператора (PII-риск: адреса/ПИБ могут встречаться).
  // Держим ВНЕ src/dist, путь без "snapshots/" (иначе .gitignore-правило `snapshots/`
  // совпадёт с любой вложенной папкой и каталог никогда не создастся). В контейнере
  // переопределяется на /var/lib/svitlo/snapshots (docker-compose.yml).
  SNAPSHOT_DIR: z.string().default('../../operator-samples/raw-snapshots'),
  PARSER_USER_AGENT: z.string().default('Svitlo/1.0'),
  SOURCE_URL: z.string().url().default('http://manual-import.invalid/disabled'),
  // Публічний веб-API оператора (сторінка /power_outages). Увімкнює автоматичне
  // отримання зареєстрованих перерв без персональних даних — без капчі.
  CHERNIHIV_WEB_ENABLED: z.string().default('false').transform((value) => value.toLowerCase() === 'true'),
  CHERNIHIV_BASE_URL: z.string().url().default('https://chernihivoblenergo.com.ua'),
  // Ідентифікатори населених пунктів на сайті оператора (через кому). 7422288601 = с. Деснянське.
  CHERNIHIV_CITY_IDS: z.string().default('7422288601').transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean)),
  // Типи перерв: 1 — планові, 2 — аварійні, 6 — графіки обмеження (ГПВ).
  CHERNIHIV_OUTAGE_TYPES: z.string().default('1,2,6').transform((value) => value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item))),
  // Оператор віддає дані лише браузероподібним клієнтам (WAF).
  CHERNIHIV_USER_AGENT: z.string().default('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'),
  // Пауза між запитами до оператора (мс) — щоб не тригерити WAF/рейт-ліміт.
  CHERNIHIV_REQUEST_DELAY_MS: z.coerce.number().default(1000),
  // Прогрів сесії: спершу GET /power_outages (cookies), потім POST /api/list_acc — як у браузера.
  CHERNIHIV_SESSION_WARMUP: z.string().default('true').transform((value) => value.toLowerCase() === 'true'),
  USE_MOCK_ADAPTER: z.string().default('false').transform((value) => value.toLowerCase() === 'true'),
  ENABLE_SCHEDULER: z.string().default('false').transform((value) => value.toLowerCase() === 'true'),
  // Довірені проксі (діапазони proxy-addr через кому), напр. "loopback,uniquelocal".
  // Порожньо = вимкнено. Потрібно, щоб rate limit рахувався по IP відвідувача, а не по IP nginx.
  TRUST_PROXY: z.string().default(''),
  TELEGRAM_BOT_ENABLED: z.string().default('false').transform((value) => value.toLowerCase() === 'true'),
  TELEGRAM_API_ID: z.string().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  TELEGRAM_SESSION: z.string().optional(),
  NOMINATIM_BASE_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_RATE_LIMIT_MS: z.coerce.number().default(1100),
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),
  TZ: z.string().default('Europe/Kyiv')
}).superRefine((value, ctx) => {
  if (value.PARSE_INTERVAL_JITTER_MINUTES >= value.PARSE_INTERVAL_MINUTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PARSE_INTERVAL_JITTER_MINUTES'],
      message: 'PARSE_INTERVAL_JITTER_MINUTES must be smaller than PARSE_INTERVAL_MINUTES',
    });
  }
});

export const env = envSchema.parse(process.env);
