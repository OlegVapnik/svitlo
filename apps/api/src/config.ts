import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  ADMIN_TOKEN: z.string().default('development-admin-token'),
  // Раніше мінімум був 30 хв («щоб не забанило WAF» — вимога skills/scraper-adapter-hardening).
  // Після дозволу оператора (2026-10-10, див. AGENTS.md) 30 хв — лише типовий дефолт, а не вимога.
  // Нижня межа 1 лишена, щоб 0 / від'ємне не зробили cron недійсним.
  PARSE_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(60),
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
  // Ідентифікатори населених пунктів на сайті оператора (через кому).
  // ПОРОЖНІЙ список = перелік НП не заданий: адаптер НЕ опитує оператора й голосно повідомляє причину.
  // Так зроблено свідомо: раніше тут стояло ОДНЕ село (7422288601 = с. Деснянське) як «типове»,
  // і виглядало, ніби ми бачимо всю Чернігівщину. Перелік наповнюється з публічного довідника
  // оператора (GET /api/info_disable?nq=city — без капчі; див. skills/scraper-adapter-hardening).
  CHERNIHIV_CITY_IDS: z.string().default('').transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean)),
  // Типи перерв: 1 — планові, 2 — аварійні, 6 — графіки обмеження (ГПВ).
  CHERNIHIV_OUTAGE_TYPES: z.string().default('1,2,6').transform((value) => value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item))),
  // Оператор віддає дані лише браузероподібним клієнтам (WAF).
  CHERNIHIV_USER_AGENT: z.string().default('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'),
  // Пауза між запитами до оператора (мс) — щоб не тригерити WAF/рейт-ліміт.
  CHERNIHIV_REQUEST_DELAY_MS: z.coerce.number().default(1000),
  // Прогрів сесії: спершу GET /power_outages (cookies), потім POST /api/list_acc — як у браузера.
  CHERNIHIV_SESSION_WARMUP: z.string().default('true').transform((value) => value.toLowerCase() === 'true'),
  // Публічний метод оператора `POST /api/info_schedule {queue, curr_dt}` — без капчі й без ПД.
  // ВАЖЛИВО (перевірено 10.10.2026, 12 запитів із контейнера, черги 2/2, 2, 1): метод — **заглушка**,
  // він завжди віддає `200 {"status":"ok","aData":null}`, тобто реальних інтервалів у ньому немає.
  // Справжній погодинний ГПВ віддає лише `POST /api/info_schedule_part`, і він за Cloudflare Turnstile
  // (`400 {"error":"No captcha"}` без токена). Токен автоматично НЕ добуваємо — див. AGENTS.md,
  // «Operator schedule and anti-bot boundary»; тому `schedule_slots` наповнюється вручну/з інших джерел.
  // Неповний TLS-ланцюжок закриває операторський CA з бандла
  // (docker-compose.yml → NODE_EXTRA_CA_CERTS), тому перевірка сертифіката лишається увімкненою.
  OPERATOR_SCHEDULE_URL: z.string().url().default('https://interruptions.energy.cn.ua/api/info_schedule'),
  // «Дзеркало» погодинного ГПВ — публічний JSON (Cloudflare Worker над DTEK-подібним API), той самий
  // формат читає Java-ядро `core/` (`BlackoutScheduleProvider`). Це єдине відоме джерело ПОВНОГО
  // добового ГПВ по Чернігівській області: `info_schedule_part` за Turnstile, а Telegram-канал пише
  // лише «зміни» (HANDOFF §18.9). ПД немає (коди черг і півгодинні коди стану), капчі немає.
  MIRROR_SCHEDULE_ENABLED: z.string().default('true').transform((value) => value.toLowerCase() === 'true'),
  MIRROR_SCHEDULE_URL: z.string().url().default('https://dtek-api.svitlo-proxy.workers.dev/'),
  // `cpu` області в дзеркалі: Чернігівська область (перевірено живим запитом 10.10.2026).
  // Це лише ТИПОВА область для API: дзеркало віддає всі області одним payload, тож `?region=`
  // у /api/v1/schedules і /api/v1/queues працює для будь-якої області без правок конфіга.
  MIRROR_SCHEDULE_REGION: z.string().default('chernihivska-oblast'),
  // Які області писати в БД під час імпорту (cron/адмінка). Порожньо = усі, що є у фіді:
  // мультирегіональність не має залежати від того, що хтось не забув дописати область у .env.
  // Явний список `cpu` через кому звужує імпорт (напр. 'chernihivska-oblast,kyiv-city').
  MIRROR_SCHEDULE_IMPORT_REGIONS: z.string().default('').transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean)),
  // TTL кешу payload у пам'яті (с): менший за PARSE_INTERVAL_MINUTES, щоб дані лишались свіжими,
  // але сторінка не смикала дзеркало на кожен запит.
  MIRROR_SCHEDULE_TTL_SEC: z.coerce.number().int().min(0).default(600),
  MIRROR_SCHEDULE_TIMEOUT_MS: z.coerce.number().default(15000),
  // --- Провайдери графіків по областях (apps/api/src/providers/**) ---
  // Синхронізація провайдерів у cron: кожен провайдер пише `schedule_slots` зі своїм `source`,
  // тому ручні/дзеркальні/telegram-рядки не затираються (ідемпотентно до рядка джерела).
  PROVIDER_SYNC_ENABLED: z.string().default('false').transform((value) => value.toLowerCase() === 'true'),
  PROVIDER_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(30),
  PROVIDER_SYNC_TIMEOUT_MS: z.coerce.number().default(15000),
  // YASNO (`api.yasno.com.ua`) стоїть за Incapsula WAF: з datacenter-IP віддає 503 на будь-які
  // заголовки (перевірено 11.10.2026 із контейнера), тому базова адреса винесена в env —
  // за потреби вказуємо власний проксі (як `dtek-api.svitlo-proxy.workers.dev` для дзеркала).
  YASNO_API_BASE_URL: z.string().url().default('https://api.yasno.com.ua'),
  // DTEK: сайти ДСО (dtek-kem — Київ, dtek-dnem — Дніпро). Прямий API пробуємо на межі адаптера.
  DTEK_API_BASE_URL: z.string().url().default('https://www.dtek-kem.com.ua'),
  DTEK_DNEM_BASE_URL: z.string().url().default('https://www.dtek-dnem.com.ua'),
  // e-svitlo — особистий кабінет АТ «Чернігівобленерго» (web2py), публічні графіки/списки населених пунктів.
  ESVITLO_BASE_URL: z.string().url().default('https://cn.e-svitlo.com.ua'),
  CHERNIHIVOBLENERGO_BASE_URL: z.string().url().default('https://chernihivoblenergo.com.ua'),
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
