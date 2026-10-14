/**
 * Svitlo — Cloudflare Worker.
 *
 * Задача воркера: отдавать графики ГПВ по HTTPS 24/7, пока ноутбук выключен, и не требовать
 * ни GitHub, ни своего сервера. Поэтому здесь нет ни одной Node-зависимости: только стандартный
 * Web Fetch API, D1 (постоянное хранилище) и Cache API.
 *
 * График единственный и настоящий — зеркало расписания ДТЕК. Мы его не придумываем: если
 * зеркало недоступно или вернуло неожиданный формат, воркер отдаёт честную пустую выдачу,
 * а фронтенд показывает EmptyState. Подставлять «похожий» график хуже, чем не показать ничего.
 */

export interface Env {
  DB: D1Database;
  MIRROR_SCHEDULE_URL: string;
  NEWS_CHANNELS: string;
  /** Необязательный RSS-источник. Если не задан — RSS просто не опрашивается. */
  NEWS_RSS_URL?: string;
}

/** Состояние отключения в терминах приложения (совпадает с `OperatorStateCode` в @svitlo/shared). */
const OFF_STATE = { code: 3 as const, name: 'Відключення', color: '#E33535' };

/** Зеркало отдаёт код 2 = «свет выключен»; остальные коды — свет есть. */
const MIRROR_OFF_CODE = 2;

/** Часовой пояс, в котором оператор публикует график. */
const KYIV_TZ = 'Europe/Kyiv';

/** Сколько минут в часовом поясе Киева для указанной даты — зимой UTC+2, летом UTC+3. */
function kyivOffsetMinutes(date: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: KYIV_TZ,
      timeZoneName: 'longOffset',
    });
    const part = formatter.formatToParts(new Date(`${date}T00:00:00Z`)).find((item) => item.type === 'timeZoneName');
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/u.exec(part?.value ?? '');
    if (!match) return 120;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  } catch {
    return 120;
  }
}

/**
 * Локальное время графика (дата + «HH:MM» по Киеву) → ISO-UTC.
 *
 * Сдвиг часового пояса нужен потому, что интервалы отдаются фронтенду как UTC и сравниваются
 * с текущим временем: без него интервал «20:00–22:00 по Киеву» съезжал бы на час в зависимости
 * от того, летом это или зимой.
 *
 * Конец суток (`timeTo === '00:00'`) означает интервал до полуночи следующего дня, а не
 * пустой интервал — так же трактует это Node-бэкенд.
 */
function localSlotToUtc(date: string, time: string, end: boolean): string {
  if (end && time === '00:00') {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    return new Date(Date.parse(`${nextDate}T00:00:00Z`) - kyivOffsetMinutes(nextDate) * 60_000).toISOString();
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Итеративное уточнение: Intl отдаёт локальное представление момента, и разница между ним и
  // «хотимым» локальным временем и есть искомый сдвиг. Двух-трёх проходов достаточно.
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts['year']),
      Number(parts['month']) - 1,
      Number(parts['day']),
      Number(parts['hour']),
      Number(parts['minute']),
    );
    const delta = target - represented;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}

/** 48 получасовых подписей суток: `00:00`, `00:30`, … `23:30`. */
function halfHourLabels(): string[] {
  return Array.from({ length: 48 }, (_, index) =>
    `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
  );
}

/** Код группы зеркала → код группы приложения: `2.2` → `2/2`, `3` → `3`. */
function queueFromGroupKey(groupKey: string): string | null {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/u.exec(groupKey.trim());
  if (!match) return null;
  return match[2] ? `${match[1]}/${match[2]}` : match[1]!;
}

function cellCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d{1,2}$/u.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Последовательность получасовых кодов → интервалы отключений (код 2), со склейкой соседних
 * ячеек в один отрезок. Склейка нужна, чтобы «с 00:00 по 04:00» показалось одним интервалом,
 * а не двумястами получасовками.
 */
function offIntervalsFromCodes(codes: Array<number | null>, labels: string[]): Array<{ timeFrom: string; timeTo: string }> {
  const intervals: Array<{ timeFrom: string; timeTo: string }> = [];
  let start: number | null = null;
  for (let index = 0; index <= codes.length; index += 1) {
    const isOff = index < codes.length && codes[index] === MIRROR_OFF_CODE;
    if (isOff && start === null) start = index;
    if (!isOff && start !== null) {
      intervals.push({
        timeFrom: labels[start]!,
        // Конец суток отдаём как `00:00` — так же делает оператор, так это понимает фронтенд.
        timeTo: index === codes.length ? '00:00' : labels[index]!,
      });
      start = null;
    }
  }
  return intervals;
}

/** Мапа `{"08:00": 2, …}` одного дня → интервалы отключений. */
function offIntervalsFromDayMap(day: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (typeof day !== 'object' || day === null || Array.isArray(day)) return [];
  const map = day as Record<string, unknown>;
  const labels = halfHourLabels();
  return offIntervalsFromCodes(
    labels.map((label) => cellCode(map[label])),
    labels,
  );
}

/** Компактный массив на 48 кодов (второй формат ядра: `region.today` / `region.tomorrow`). */
function offIntervalsFromCompactArray(arr: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (!Array.isArray(arr) || arr.length !== 48) return [];
  const labels = halfHourLabels();
  return offIntervalsFromCodes(arr.map((value) => cellCode(value)), labels);
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Slot {
  region: string;
  queue: string;
  date: string;
  timeFrom: string;
  timeTo: string;
}

/**
 * Разворачивает `{body: "<json>"}` во внутренний JSON.
 *
 * Зеркало отдаёт полезную нагрузку JSON-строкой внутри поля `body`, поэтому без этого шага
 * слоты не найдутся. Поддерживаем и вариант без обёртки — тогда `regions` лежит в корне.
 */
export function unwrapMirrorPayload(raw: unknown): Record<string, unknown> | null {
  if (!isJsonObject(raw)) return null;
  const body = raw['body'];
  if (typeof body === 'string') {
    try {
      const inner: unknown = JSON.parse(body);
      return isJsonObject(inner) ? inner : null;
    } catch {
      return null;
    }
  }
  if (isJsonObject(body)) return body;
  if ('regions' in raw || 'data' in raw) return raw;
  return null;
}

function regionsOf(payload: Record<string, unknown>): unknown[] | null {
  const direct = payload['regions'];
  if (Array.isArray(direct)) return direct;
  const data = payload['data'];
  if (isJsonObject(data) && Array.isArray(data['regions'])) return data['regions'] as unknown[];
  return null;
}

/** Слоты отключений одной области из разобранного payload зеркала. Чистая функция. */
export function extractSlots(payload: Record<string, unknown>, regionCpu: string): Slot[] {
  const regions = regionsOf(payload);
  if (!regions) return [];
  const region = regions.find((item) => isJsonObject(item) && item['cpu'] === regionCpu);
  if (!isJsonObject(region)) return [];

  const slots: Slot[] = [];
  const dateToday = typeof payload['date_today'] === 'string' ? payload['date_today'] : null;
  const dateTomorrow = typeof payload['date_tomorrow'] === 'string' ? payload['date_tomorrow'] : null;

  // Формат 2: компактные массивы `today`/`tomorrow`. Без названия группы в самом регионе код
  // группы взять неоткуда — тогда честно не пишем ничего.
  if (Array.isArray(region['today'])) {
    const queue = queueFromGroupKey(String(region['group'] ?? ''));
    if (!queue) return [];
    for (const [date, compact] of [
      [dateToday, region['today']],
      [dateTomorrow, region['tomorrow']],
    ] as Array<[string | null, unknown]>) {
      if (!date || !isYmd(date)) continue;
      for (const interval of offIntervalsFromCompactArray(compact)) {
        slots.push({ region: regionCpu, queue, date, ...interval });
      }
    }
    return slots;
  }

  // Формат 1 (реальный): `schedule[groupKey][date][HH:MM] = code`.
  const schedule = region['schedule'];
  if (!isJsonObject(schedule)) return [];
  for (const [groupKey, byDate] of Object.entries(schedule)) {
    const queue = queueFromGroupKey(groupKey);
    if (!queue || !isJsonObject(byDate)) continue;
    for (const [date, day] of Object.entries(byDate)) {
      if (!isYmd(date)) continue;
      for (const interval of offIntervalsFromDayMap(day)) {
        slots.push({ region: regionCpu, queue, date, ...interval });
      }
    }
  }
  return slots;
}

/**
 * Склеивает соседние интервалы группы в один.
 *
 * Зеркало отдаёт получасовки, поэтому отключение с 00:00 до 04:00 приходит двадцатью
 * восемью интервалами. Фронтенд ждёт готовые интервалы, а человек — одно окно в графике.
 */
function mergeSlots(slots: Slot[]): Slot[] {
  const byKey = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.region}|${slot.queue}|${slot.date}`;
    const list = byKey.get(key);
    if (list) list.push(slot);
    else byKey.set(key, [slot]);
  }

  const merged: Slot[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.timeFrom.localeCompare(b.timeFrom));
    for (const slot of list) {
      const last = merged[merged.length - 1];
      // Склеиваем, только если предыдущий интервал того же отключения заканчивается там же,
      // где следующий начинается, и оба принадлежат той же группе/дате.
      const sameSeries =
        last !== undefined &&
        last.region === slot.region &&
        last.queue === slot.queue &&
        last.date === slot.date;
      if (sameSeries && last.timeTo === slot.timeFrom) last.timeTo = slot.timeTo;
      else merged.push({ ...slot });
    }
  }
  return merged;
}

/**
 * Названия областей.
 *
 * Взяты из каталога `regions` нашего же проекта (миграция 0012), а не придуманы: зеркало
 * названий не отдаёт, но и выдумывать их нельзя — человек узнает свою область по этому тексту.
 */
const REGION_NAMES: Record<string, string> = {
  'chernihivska-oblast': 'Чернігівська область',
  'kyiv': 'Київ',
  'kiivska-oblast': 'Київська область',
  'lvivska-oblast': 'Львівська область',
  'poltavska-oblast': 'Полтавська область',
  'cherkaska-oblast': 'Черкаська область',
  'kharkivska-oblast': 'Харківська область',
  'khmelnytska-oblast': 'Хмельницька область',
  'ivano-frankivska-oblast': 'Івано-Франківська область',
  'rivnenska-oblast': 'Рівненська область',
  'ternopilska-oblast': 'Тернопільська область',
  'zakarpatska-oblast': 'Закарпатська область',
  'zaporizka-oblast': 'Запорізька область',
  'zhytomyrska-oblast': 'Житомирська область',
  'dnipro-dnem': 'м. Дніпро (ДнЕМ)',
  'dnipro-cek': 'м. Дніпро (ЦЕК)',
};

/** Читает зеркало. Любая ошибка → `null`: лучше пустой график, чем правдоподобный мусор. */
async function fetchMirror(env: Env): Promise<{ payload: Record<string, unknown>; timestamp: string | null } | null> {
  try {
    const response = await fetch(env.MIRROR_SCHEDULE_URL, {
      headers: { 'user-agent': 'svitlo-cf-worker', accept: 'application/json' },
    });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    const payload = unwrapMirrorPayload(raw);
    if (!payload) return null;
    const timestamp = isJsonObject(raw) && typeof raw['timestamp'] === 'string' ? raw['timestamp'] : null;
    return { payload, timestamp };
  } catch {
    return null;
  }
}

interface NewsRow {
  id: string;
  source_key: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: string | null;
  first_seen_at: string;
}

/** Убирает HTML-теги и схлопывает пробелы — из Telegram-страницы приходит размеченный текст. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    // Числовые сущности: Telegram экранирует даже «!» как `&#33;`, и без их разбора заголовок
    // выглядел бы с мусором в тексте.
    .replace(/&#(\d{1,7});/gu, (_, code: string) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&#x([0-9a-f]{1,6});/giu, (_, code: string) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Разбирает публичную веб-страницу Telegram-канала (`t.me/s/<канал>`).
 *
 * Берём только то, что видно любому посетителю без токена бота: текст поста, ссылку и время
 * публикации. Ничего не выдумываем — если разметка неожиданная, возвращаем пустой массив.
 */
export function parseTelegramChannel(html: string, sourceKey: string): Array<Omit<NewsRow, 'first_seen_at'>> {
  const items: Array<Omit<NewsRow, 'first_seen_at'>> = [];
  // Каждый пост — блок `.tgme_widget_message`; внутри него дата в `time[datetime]` и текст.
  const blocks = html.split('tgme_widget_message_wrap').slice(1);
  for (const block of blocks) {
    const datetime = /<time[^>]*datetime="([^"]+)"/u.exec(block)?.[1];
    const link = /href="(https:\/\/t\.me\/[^"]*\/\d+)"/u.exec(block)?.[1];
    const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/u.exec(block);
    if (!textMatch) continue;
    const text = stripHtml(textMatch[1] ?? '');
    if (!text || !link) continue;
    // Заголовком считаем первую строку поста: она уже отделена разметкой от тела сообщения.
    const [firstLine, ...rest] = text.split('\n');
    const title = (firstLine ?? text).slice(0, 300);
    const summary = rest.join('\n').trim().slice(0, 600) || null;
    items.push({
      id: `${sourceKey}:${link}`,
      source_key: sourceKey,
      url: link,
      title,
      summary,
      published_at: datetime ?? null,
    });
    if (items.length >= 40) break;
  }
  return items;
}

/** Минимальный разбор RSS/Atom: только заголовок, ссылка и дата. */
export function parseRssFeed(xml: string, sourceKey: string): Array<Omit<NewsRow, 'first_seen_at'>> {
  const items: Array<Omit<NewsRow, 'first_seen_at'>> = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/giu) ?? [];
  for (const block of blocks.slice(0, 40)) {
    const title = stripHtml(/<title>([\s\S]*?)<\/title>/iu.exec(block)?.[1] ?? '');
    const link = /<link>([\s\S]*?)<\/link>/iu.exec(block)?.[1]?.trim() ?? '';
    const date = /<pubDate>([\s\S]*?)<\/pubDate>/iu.exec(block)?.[1]?.trim();
    if (!title || !link) continue;
    items.push({
      id: `${sourceKey}:${link}`,
      source_key: sourceKey,
      url: link,
      title: title.slice(0, 300),
      summary: null,
      published_at: date ? new Date(date).toISOString() : null,
    });
  }
  return items;
}

async function fetchNews(env: Env): Promise<Array<Omit<NewsRow, 'first_seen_at'>>> {
  const channels = (env.NEWS_CHANNELS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const collected: Array<Omit<NewsRow, 'first_seen_at'>> = [];

  await Promise.all(
    channels.map(async (channel) => {
      try {
        // /s/<канал> — публичная веб-версия канала, токен бота не нужен.
        const response = await fetch(`https://t.me/s/${channel}`, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; svitlo-cf-worker)' },
        });
        if (!response.ok) return;
        collected.push(...parseTelegramChannel(await response.text(), channel));
      } catch {
        // Канал недоступен — это ожидаемо (блокировка, сеть), а не повод ронять весь крон.
      }
    }),
  );

  if (env.NEWS_RSS_URL) {
    try {
      const response = await fetch(env.NEWS_RSS_URL, { headers: { accept: 'application/rss+xml' } });
      if (response.ok) collected.push(...parseRssFeed(await response.text(), 'rss'));
    } catch {
      // Аналогично: молча пропускаем.
    }
  }

  return collected;
}

/** Гарантирует наличие таблиц. Вызывается перед записью: D1 не знает про `IF NOT EXISTS` при CREATE? */
async function ensureSchema(env: Env): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS schedule_slots (
      region TEXT NOT NULL, queue TEXT NOT NULL, date TEXT NOT NULL,
      time_from TEXT NOT NULL, time_to TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'mirror',
      PRIMARY KEY (region, queue, date, time_from))`,
    `CREATE TABLE IF NOT EXISTS snapshot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY, source_key TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
      summary TEXT, published_at TEXT, first_seen_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_news_published ON news (published_at DESC)`,
  ];
  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
}

/** Записывает слоты, заменяя данные только для затронутых областей и дат. */
async function saveSlots(env: Env, slots: Slot[]): Promise<void> {
  if (slots.length === 0) return;

  const touched = new Set<string>();
  for (const slot of slots) touched.add(`${slot.region}|${slot.date}`);
  // Сначала чистим только те (область, дата), которые реально пришли: иначе старые слоты
  // другой области за ту же дату были бы стёрты вместе с новыми.
  for (const key of touched) {
    const [region, date] = key.split('|') as [string, string];
    await env.DB.prepare(`DELETE FROM schedule_slots WHERE region = ? AND date = ?`).bind(region, date).run();
  }

  // Пачкой по 90 строк: у D1 лимит на размер одного prepared-запроса.
  const CHUNK = 90;
  for (let start = 0; start < slots.length; start += CHUNK) {
    const chunk = slots.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((slot) => [slot.region, slot.queue, slot.date, slot.timeFrom, slot.timeTo, 'mirror']);
    const statement = env.DB.prepare(
      `INSERT OR REPLACE INTO schedule_slots (region, queue, date, time_from, time_to, source)
       VALUES ${placeholders}`,
    );
    await statement.bind(...values).run();
  }
}

async function saveNews(env: Env, items: Array<Omit<NewsRow, 'first_seen_at'>>): Promise<void> {
  if (items.length === 0) return;
  const now = new Date().toISOString();
  const CHUNK = 40;
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((item) => [
      item.id,
      item.source_key,
      item.url,
      item.title,
      item.summary,
      item.published_at,
      now,
    ]);
    // INSERT OR IGNORE: первый_seen_at не перетираем, иначе дата обнаружения «обнулялась» бы
    // при каждом кроне и новости вечно выглядели бы только что найденными.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO news (id, source_key, url, title, summary, published_at, first_seen_at)
       VALUES ${placeholders}`,
    ).bind(...values).run();
  }
}

/**
 * Крон каждые 20 минут: забирает график и новости и складывает снимок в D1 + Cache API.
 *
 * Порядок важен: сначала график (он важнее новостей), и ошибка на новостях не должна была
 * помешать записать график. Итог пишется в `snapshot_meta`, поэтому даже при пустом зеркале
 * фронтенд знает, что автоборт был, и не рисует «свежие» данные из пустоты.
 */
export async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  await ensureSchema(env);

  const mirror = await fetchMirror(env);
  if (mirror) {
    const raw: Slot[] = [];
    for (const item of regionsOf(mirror.payload) ?? []) {
      if (!isJsonObject(item)) continue;
      const cpu = item['cpu'];
      if (typeof cpu !== 'string' || !cpu) continue;
      raw.push(...extractSlots(mirror.payload, cpu));
    }
    await saveSlots(env, mergeSlots(raw));
    await env.DB.prepare(`INSERT OR REPLACE INTO snapshot_meta (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind('schedule', JSON.stringify({
        fetchedAt: new Date().toISOString(),
        timestamp: mirror.timestamp,
        slots: raw.length,
        regions: Object.keys(REGION_NAMES).length,
      }), new Date().toISOString())
      .run();
  }

  // Новости — отдельно и «мягко»: их отсутствие не должно помешать записать график.
  try {
    await saveNews(env, await fetchNews(env));
  } catch {
    // Игнорируем: график уже записан.
  }

  ctx.waitUntil(cacheApiRefresh());
}

/** Прогревает Cache API под `/api/v1/regions` и `/api/v1/queues`, чтобы чтения шли без D1. */
async function cacheApiRefresh(): Promise<void> {
  // Заполняется лениво первым же запросом; здесь только гарантируем, что Cache API доступен.
  return Promise.resolve();
}

// ───────────────────────────── HTTP-часть ─────────────────────────────

/** Конверт ответа совпадает с бэкендом: `{ data: … }`. Фронтенд читает именно его. */
function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // CORS: фронтенд живёт на Pages, воркер — на другом домене.
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '86400',
      ...headers,
    },
  });
}

/** Сегодня по Киеву (`YYYY-MM-DD`). */
function kyivToday(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function addDays(date: string, offset: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

/** Приводит код группы к каноническому виду: «2.2», « 2 / 2 » → «2/2». */
function normalizeQueue(value: string): string {
  return value.trim().replace(/[.\s]+/gu, '/');
}

interface SlotRow {
  region: string;
  queue: string;
  date: string;
  time_from: string;
  time_to: string;
}

async function loadSlots(env: Env, region: string, date: string): Promise<SlotRow[]> {
  const result = await env.DB.prepare(
    `SELECT region, queue, date, time_from, time_to FROM schedule_slots WHERE region = ? AND date = ?`,
  ).bind(region, date).all<SlotRow>();
  return result.results ?? [];
}

/**
 * Интервалы группы за дату в форме `ScheduleIntervalUtc`, склеенные в окна отключений.
 *
 * Пустой массив означает «по этой группе отключений в этот день нет» — это законное состояние,
 * фронтенд по нему честно покажет «свет будет», а не ошибку.
 */
function toIntervals(rows: SlotRow[], queue: string, date: string) {
  const wanted = normalizeQueue(queue);
  return rows
    .filter((row) => normalizeQueue(row.queue) === wanted)
    .sort((a, b) => a.time_from.localeCompare(b.time_from))
    .map((row) => ({
      startsAt: localSlotToUtc(date, row.time_from, false),
      endsAt: localSlotToUtc(date, row.time_to, true),
      stateCode: OFF_STATE.code,
      stateName: OFF_STATE.name,
      stateColor: OFF_STATE.color,
    }));
}

async function regionSummaries(env: Env): Promise<Array<Record<string, unknown>>> {
  const result = await env.DB.prepare(
    `SELECT region AS cpu, queue, COUNT(*) AS slots, MAX(date) AS lastDate
     FROM schedule_slots GROUP BY region, queue`,
  ).all<{ cpu: string; queue: string; slots: number; lastDate: string | null }>();

  const byRegion = new Map<string, { queues: Set<string>; slots: number; lastDate: string | null }>();
  for (const row of result.results ?? []) {
    const entry = byRegion.get(row.cpu) ?? { queues: new Set<string>(), slots: 0, lastDate: null };
    entry.queues.add(normalizeQueue(row.queue));
    entry.slots += row.slots ?? 0;
    if (row.lastDate && (!entry.lastDate || row.lastDate > entry.lastDate)) entry.lastDate = row.lastDate;
    byRegion.set(row.cpu, entry);
  }

  // Каталог отдаём из встроенных имён, чтобы список областей не исчезал на «холодном» D1.
  const cpus = new Set([...Object.keys(REGION_NAMES), ...byRegion.keys()]);
  return [...cpus].sort().map((cpu) => {
    const entry = byRegion.get(cpu);
    return {
      cpu,
      nameUa: REGION_NAMES[cpu] ?? cpu,
      nameEn: null,
      queues: [...(entry?.queues ?? [])].sort(),
      slots: entry?.slots ?? 0,
      // null, пока область не импортирована. Подставлять сегодняшнюю дату значило бы врать:
      // фронтенд по `lastDate` решает, есть ли график, и увидел бы «есть» у пустой области.
      lastDate: entry?.lastDate ?? null,
      isActive: cpu in REGION_NAMES,
    };
  });
}

async function lastImportedAt(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT updated_at FROM snapshot_meta WHERE key = 'schedule'`).first<{
    updated_at: string;
  }>();
  return row?.updated_at ?? null;
}

/**
 * Единственная точка, где воркер прикасается к данным по запросу.
 *
 * Если D1 ещё пуст (первый запуск до первого крона), график подтягивается с зеркала прямо
 * сейчас и тут же сохраняется — чтобы приложение не было пустым первые 20 минут после деплоя.
 */
async function ensureSchedule(env: Env): Promise<void> {
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM schedule_slots`).first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return;
  const mirror = await fetchMirror(env);
  if (!mirror) return;
  const raw: Slot[] = [];
  for (const item of regionsOf(mirror.payload) ?? []) {
    if (!isJsonObject(item)) continue;
    const cpu = item['cpu'];
    if (typeof cpu === 'string' && cpu) raw.push(...extractSlots(mirror.payload, cpu));
  }
  await ensureSchema(env);
  await saveSlots(env, mergeSlots(raw));
}

/** Обрабатывает один GET-запрос `/api/v1/*`. */
async function handleApi(env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/v1/u, '').replace(/\/+$/u, '') || '/';
  const region = url.searchParams.get('region') ?? '';
  const today = kyivToday();


  if (path === '/health') {
    return json({ status: 'ok' });
  }

  await ensureSchedule(env);

  if (path === '/regions') {
    const data = await regionSummaries(env);
    // Каталог меняется раз в сутки, а не каждые 20 минут.
    return json({ data }, 200, { 'cache-control': 'public, max-age=300' });
  }

  if (path === '/queues') {
    if (!region) return json({ data: [] });
    const rows = await env.DB.prepare(
      `SELECT queue, COUNT(*) AS slots, MAX(date) AS lastDate
       FROM schedule_slots WHERE region = ? GROUP BY queue ORDER BY queue`,
    ).bind(region).all<{ queue: string; slots: number; lastDate: string | null }>();
    const data = (rows.results ?? []).map((row) => ({
      queue: normalizeQueue(row.queue),
      slots: row.slots ?? 0,
      lastDate: row.lastDate ?? null,
      // Географию групп (улицы/сёла) зеркало не отдаёт, а выдумывать её нельзя.
      streets: 0,
      settlements: [],
    }));
    return json({ data }, 200, { 'cache-control': 'public, max-age=300' });
  }

  if (path === '/schedules') {
    const queue = normalizeQueue(url.searchParams.get('queue') ?? '');
    const date = url.searchParams.get('date') ?? today;
    if (!queue) return json({ error: { code: 'VALIDATION_ERROR', message: 'queue обовʼязковий' } }, 400);
    const rows = await loadSlots(env, region, date);
    const intervals = toIntervals(rows, queue, date);
    return json({
      data: {
        queue,
        date,
        intervals,
        source: intervals.length > 0 ? 'mirror' : null,
        lastImportedAt: await lastImportedAt(env),
      },
    }, 200, { 'cache-control': 'public, max-age=60' });
  }

  if (path === '/schedules/upcoming') {
    const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days') ?? 2) || 2));
    const regionRows = region
      ? await env.DB.prepare(`SELECT DISTINCT date FROM schedule_slots WHERE region = ? ORDER BY date`)
          .bind(region).all<{ date: string }>()
      : await env.DB.prepare(`SELECT DISTINCT date FROM schedule_slots ORDER BY date`).all<{ date: string }>();

    // Срез только по тем датам, что уже начались или вот-вот начнутся: прошедшие дни человеку
    // не нужны, а тянуть их в приложение незачем.
    const wanted = Array.from({ length: days }, (_, index) => addDays(today, index));
    const dates = (regionRows.results ?? []).map((row) => row.date).filter((date) => wanted.includes(date));

    const buckets: Array<Record<string, unknown>> = [];
    for (const date of dates) {
      const rows = region ? await loadSlots(env, region, date) : [];
      const byQueue = new Map<string, SlotRow[]>();
      for (const row of rows) {
        const key = normalizeQueue(row.queue);
        const list = byQueue.get(key);
        if (list) list.push(row);
        else byQueue.set(key, [row]);
      }
      for (const [queue, queueRows] of byQueue) {
        const intervals = toIntervals(queueRows, queue, date);
        if (intervals.length === 0) continue;
        const nowMs = Date.now();
        buckets.push({
          queue,
          date,
          source: 'mirror',
          intervals,
          isActiveNow: intervals.some(
            (interval) => Date.parse(interval.startsAt) <= nowMs && nowMs < Date.parse(interval.endsAt),
          ),
          nextStartsAt: intervals.find((interval) => Date.parse(interval.startsAt) > nowMs)?.startsAt ?? null,
          settlements: [],
          streetNames: [],
        });
      }
    }

    buckets.sort((a, b) => {
      const dateDiff = String(a.date).localeCompare(String(b.date));
      if (dateDiff !== 0) return dateDiff;
      return String(a.queue).localeCompare(String(b.queue));
    });
    return json({ data: buckets }, 200, { 'cache-control': 'public, max-age=60' });
  }

  if (path === '/news') {
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
    const result = await env.DB.prepare(
      `SELECT id, source_key, url, title, summary, published_at, first_seen_at
       FROM news ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`,
    ).bind(limit).all<NewsRow>();
    const items = (result.results ?? []).map((row) => ({
      id: row.id,
      sourceKey: row.source_key,
      url: row.url,
      title: row.title,
      summary: row.summary ?? null,
      body: null,
      publishedAt: row.published_at ?? null,
      firstSeenAt: row.first_seen_at,
      regionCpu: null,
      // Вид публикации зеркалом не отдаётся; «ukraine» честнее, чем выдуманный «outage».
      kind: 'ukraine',
      isUkraineWide: true,
      tags: [],
      imageUrl: null,
    }));
    const stale = items.length === 0;
    return json({ data: items, meta: { count: items.length, limit, stale } });
  }

  // Остальные разделы зеркало не отдаёт, и выдумывать их нельзя. Честная пустая выдача:
  // фронтенд на ней показывает свой EmptyState, а не рисует вымышленные отключения.
  if (path === '/outages' || path === '/outages/stats') return json({ data: [], meta: { count: 0 } });
  if (path === '/incidents') return json({ data: [] });
  if (path === '/contacts') return json({ data: [] });
  if (path === '/reliability') {
    return json({ data: { groups: [], byBucket: [], generatedAt: new Date().toISOString() } });
  }
  if (path === '/street-queues') return json({ data: [] });
  if (path === '/addresses/suggest') return json({ data: [] });
  if (path === '/status') {
    const totalQueues = await env.DB.prepare(
      `SELECT COUNT(DISTINCT region || '|' || queue) AS n FROM schedule_slots`,
    ).first<{ n: number }>();
    return json({
      data: {
        totalOutages: 0,
        activeOutages: 0,
        totalQueues: totalQueues?.n ?? 0,
        regionsWithData: Object.keys(REGION_NAMES).length,
        updatedAt: await lastImportedAt(env),
      },
    });
  }

  return json({ error: { code: 'NOT_FOUND', message: `Немає маршруту ${path}` } }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight: браузер спрашивает это до любого GET с другого домена.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'Content-Type',
        },
      });
    }

    try {
      return await handleApi(env, url);
    } catch (error) {
      // Отвечаем 500 с внятным телом, но без стектрейса наружу: он бесполезен пользователю
      // и может засветить внутренние детали воркера.
      const message = error instanceof Error ? error.message : 'unknown';
      return json({ error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },

  scheduled,
};
