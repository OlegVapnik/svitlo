/**
 * Імпорт погодинного ГПВ з ПУБЛІЧНОГО Telegram-каналу оператора (t.me/s/chernigivoblenergo).
 *
 * Навіщо: погодинний графік за номером черги оператор віддає ЛИШЕ через `POST /api/info_schedule_part`,
 * який закритий Cloudflare Turnstile (перевірено 10.10.2026, див. HANDOFF §18.9), а обхід капчі ми не
 * робимо. Натомість у публічних постах каналу оператор сам пише чергу й час, напр.:
 *   «🕗 З 16:40 до 18:30 додатково відключається черга 6/2.»
 *   «🕗 До 15:00 додатково відключаються черга 2/2.»
 * Це відкриті дані без персональної інформації, тому вони законно наповнюють `schedule_slots`.
 *
 * Обмеження, яке треба знати: у каналі публікують **зміни** («додатково відключається»), а не повний
 * добовий ГПВ на всі черги; повний графік висить на сайті за капчею. Тому це доповнення до ручного
 * імпорту, а не його повна заміна. Сирі тексти ми не дублюємо: вони вже в `telegram_posts`.
 */
import type { OperatorStateCode } from '@svitlo/shared';

/** Джерело в `schedule_slots.source`: видно, звідки взялися слоти. */
export const TELEGRAM_SCHEDULE_SOURCE = 'telegram';

/**
 * Стан «відключення» в легенді оператора (його ж `aState`): код 3, `Відключення`, `#E33535`.
 * Значення зафіксовані в `apps/api/tests/services/operator-schedule.test.ts` і збігаються з
 * `OFF_STATE_CODE = 3` у `apps/web/src/lib/scheduleWindow.ts` — не вигадуємо своїх.
 */
export const TELEGRAM_OFF_STATE = { code: 3 as OperatorStateCode, name: 'Відключення', color: '#E33535' };

export type TelegramScheduleSlot = { queue: string; date: string; timeFrom: string; timeTo: string };

export type TelegramScheduleImportResult = {
  /** Постів `kind = 'outage_schedule'`, які переглянули. */
  posts: number;
  /** Скільки постів дали хоч один інтервал із чергою. */
  matchedPosts: number;
  /** Скільки слотів реально записано (без конфліктів із наявними рядками). */
  imported: number;
  /** Черги, яких торкнувся імпорт. */
  queues: string[];
  /** Дати (YYYY-MM-DD), яких торкнувся імпорт. */
  dates: string[];
};

/** Місяці в родовому відмінку — так їх пише оператор («на 9 жовтня»). */
const KYIV_MONTHS: Record<string, number> = {
  січня: 1, лютого: 2, березня: 3, квітня: 4, травня: 5, червня: 6,
  липня: 7, серпня: 8, вересня: 9, жовтня: 10, листопада: 11, грудня: 12,
};

/** «черга 2/2», «черги 6/2», «чергу 3» — код черги після слова «черга». */
const QUEUE_RE = /черг(?:а|и|і|у)\s*[№:]?\s*(\d{1,2}(?:\/\d{1,2})?)/giu;
/** «з 16:40 до 18:30» (розділювач — «до», «по», дефіс, тире). */
const RANGE_RE = /(\d{1,2}[:.]\d{2})\s*(?:—|–|-|до|по)\s*(\d{1,2}[:.]\d{2})/giu;
/** «до 15:00» — початок доби. Без `\b`: у JS `\b` не діє для кирилиці (вона не `\w`). */
const UNTIL_RE = /до\s+(\d{1,2}[:.]\d{2})/giu;
/** «на 9 жовтня» / «9 жовтня». */
const DATE_RE = /(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/iu;

/** Київська дата YYYY-MM-DD для моменту публікації (та сама логіка, що в routes/schedules.ts). */
export function kyivDateOf(moment: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(moment);
}

function shiftDate(dateYMD: string, days: number): string {
  const next = new Date(`${dateYMD}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * Дата, про яку йдеться в пості. Пріоритет: «на 9 жовтня» → «сьогодні»/«завтра» → дата публікації.
 * Рік беремо з дати публікації; якщо вийшло більш ніж на тиждень раніше за публікацію — це перехід
 * через Новий рік, отже рік наступний.
 */
export function resolveScheduleDate(text: string, publishedAt: Date): string {
  const published = kyivDateOf(publishedAt);
  if (/(?:^|[^\p{L}])завтра(?!\p{L})/iu.test(text)) return shiftDate(published, 1);
  if (/(?:^|[^\p{L}])сьогодні(?!\p{L})/iu.test(text)) return published;
  const match = DATE_RE.exec(text);
  if (!match) return published;
  const day = Number(match[1]);
  const month = KYIV_MONTHS[match[2]!.toLowerCase()] ?? 0;
  if (!day || !month) return published;
  const year = Number(published.slice(0, 4));
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return candidate < shiftDate(published, -7) ? `${year + 1}-${candidate.slice(5)}` : candidate;
}

/** «16.40» → «16:40», «8:05» → «08:05». Некоректний час (25:00, 12:75) → null. */
function normalizeTime(raw: string): string | null {
  const match = /^(\d{1,2})[:.](\d{2})$/u.exec(raw.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours! * 60 + minutes!;
}

/**
 * Розбирає текст одного поста в слоти `{queue, date, timeFrom, timeTo}`.
 *
 * Чому вікно навколо черги, а не «рядок = інтервал»: оператор пише одним рядком і час, і чергу
 * («З 16:40 до 18:30 додатково відключається черга 6/2»), а в одному пості може бути кілька черг.
 * Тому для кожної згадки черги беремо найближчий інтервал, який стоїть ПЕРЕД нею в межах 200 символів.
 */
export function parseTelegramScheduleText(text: string, publishedAt: Date): TelegramScheduleSlot[] {
  const date = resolveScheduleDate(text, publishedAt);
  const ranges: Array<{ end: number; from: string; to: string }> = [];
  for (const match of text.matchAll(RANGE_RE)) {
    const from = normalizeTime(match[1]!);
    const to = normalizeTime(match[2]!);
    if (!from || !to || from === to) continue;
    ranges.push({ end: match.index + match[0].length, from, to });
  }
  const untils: Array<{ end: number; to: string }> = [];
  for (const match of text.matchAll(UNTIL_RE)) {
    const to = normalizeTime(match[1]!);
    if (!to || to === '00:00') continue;
    untils.push({ end: match.index + match[0].length, to });
  }

  const slots: TelegramScheduleSlot[] = [];
  for (const match of text.matchAll(QUEUE_RE)) {
    const queueIndex = match.index;
    const before = ranges.filter((range) => range.end <= queueIndex && queueIndex - range.end <= 200).at(-1);
    if (before) {
      slots.push({ queue: match[1]!, date, timeFrom: before.from, timeTo: before.to });
      continue;
    }
    // «до 15:00 додатково відключаються черга 2/2» — відключення від початку доби.
    const until = untils.filter((item) => item.end <= queueIndex && queueIndex - item.end <= 200).at(-1);
    if (until) slots.push({ queue: match[1]!, date, timeFrom: '00:00', timeTo: until.to });
  }
  return mergeTelegramSlots(slots);
}

/** Склеює сусідні та перекривані інтервали однієї черги й дати, щоб не було дублів за `time_from`. */
export function mergeTelegramSlots(slots: TelegramScheduleSlot[]): TelegramScheduleSlot[] {
  const byKey = new Map<string, TelegramScheduleSlot[]>();
  for (const slot of slots) {
    const key = `${slot.queue}|${slot.date}`;
    byKey.set(key, [...(byKey.get(key) ?? []), slot]);
  }
  const merged: TelegramScheduleSlot[] = [];
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => minutesOf(a.timeFrom) - minutesOf(b.timeFrom));
    const acc: TelegramScheduleSlot[] = [];
    for (const slot of sorted) {
      const previous = acc.at(-1);
      const previousEnd = previous ? (previous.timeTo === '00:00' ? 24 * 60 : minutesOf(previous.timeTo)) : -1;
      if (previous && minutesOf(slot.timeFrom) <= previousEnd) {
        // Перекриття/стик: розширюємо наявний інтервал, а не плодимо другий із тим самим `time_from`.
        if (previous.timeTo !== '00:00') {
          const currentEnd = slot.timeTo === '00:00' ? 24 * 60 : minutesOf(slot.timeTo);
          if (currentEnd > previousEnd) previous.timeTo = slot.timeTo;
        }
        continue;
      }
      acc.push({ ...slot });
    }
    merged.push(...acc);
  }
  return merged.sort(
    (a, b) => a.date.localeCompare(b.date) || a.queue.localeCompare(b.queue) || minutesOf(a.timeFrom) - minutesOf(b.timeFrom),
  );
}

/**
 * Пише розібрані слоти в `schedule_slots` (стан «відключення», `source = 'telegram'`).
 *
 * Важливо: перезаписуємо лише власні рядки (`source = 'telegram'`) за тими ж чергою/датою — ручний і
 * операторський імпорт не чіпаємо, а конфлікт за `(queue, date, time_from)` лишаємо за ними
 * (`onConflictDoNothing`), щоб не затерти повніший графік.
 */
export async function importTelegramScheduleSlots(slots: TelegramScheduleSlot[]): Promise<TelegramScheduleImportResult> {
  const { db } = await import('../db/connection.js');
  const { scheduleSlots } = await import('../db/schema.js');
  const { and, eq } = await import('drizzle-orm');

  const keys = [...new Set(slots.map((slot) => `${slot.queue}|${slot.date}`))];
  let imported = 0;
  if (keys.length > 0) {
    await db.transaction(async (tx) => {
      for (const key of keys) {
        const [queue, date] = key.split('|');
        await tx.delete(scheduleSlots).where(and(
          eq(scheduleSlots.queue, queue!),
          eq(scheduleSlots.date, date!),
          eq(scheduleSlots.source, TELEGRAM_SCHEDULE_SOURCE),
        ));
      }
      for (const slot of slots) {
        const rows = await tx.insert(scheduleSlots).values({
          queue: slot.queue,
          date: slot.date,
          timeFrom: slot.timeFrom,
          timeTo: slot.timeTo,
          stateCode: TELEGRAM_OFF_STATE.code,
          stateName: TELEGRAM_OFF_STATE.name,
          stateColor: TELEGRAM_OFF_STATE.color,
          source: TELEGRAM_SCHEDULE_SOURCE,
        }).onConflictDoNothing().returning({ id: scheduleSlots.id });
        imported += rows.length;
      }
    });
  }
  return {
    posts: 0,
    matchedPosts: 0,
    imported,
    queues: [...new Set(slots.map((slot) => slot.queue))].sort(),
    dates: [...new Set(slots.map((slot) => slot.date))].sort(),
  };
}

/** Один пост каналу так, як він лежить у `telegram_posts`. */
export type TelegramSchedulePost = { text: string; publishedAt: Date };

/** Розбирає набір постів і пише знайдені слоти в БД (див. `importTelegramScheduleSlots`). */
export async function importTelegramScheduleFromPosts(posts: TelegramSchedulePost[]): Promise<TelegramScheduleImportResult> {
  const parsed = posts.map((post) => ({ post, slots: parseTelegramScheduleText(post.text, post.publishedAt) }));
  const all = parsed.flatMap((item) => item.slots);
  const result = await importTelegramScheduleSlots(all);
  return { ...result, posts: posts.length, matchedPosts: parsed.filter((item) => item.slots.length > 0).length };
}

/**
 * Імпорт з уже збережених постів каналу (їх кладе `TelegramChannelAdapter` під час звичайного
 * парсингу). Мережа тут не потрібна: читаємо `telegram_posts` і пишемо `schedule_slots`.
 * За замовчуванням беремо пости за останні 14 діб — старі «зміни» вже неактуальні.
 *
 * Це і Є автоматичний шлях: `parse.service` викликає функцію після кожного прогону парсингу, тож
 * будь-яка правка графіка в каналі сама доїжджає у `schedule_slots` (без кнопки в адмінці).
 */
export async function importTelegramSchedule(days = 14): Promise<TelegramScheduleImportResult> {
  const { db } = await import('../db/connection.js');
  const { telegramPosts } = await import('../db/schema.js');
  const { and, eq, gte, desc } = await import('drizzle-orm');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ text: telegramPosts.postText, publishedAt: telegramPosts.publishedAt })
    .from(telegramPosts)
    .where(and(eq(telegramPosts.kind, 'outage_schedule'), gte(telegramPosts.publishedAt, since)))
    .orderBy(desc(telegramPosts.publishedAt));
  return importTelegramScheduleFromPosts(rows);
}
