/**
 * ГПВ з ПУБЛІЧНИХ Telegram-каналів операторів (`t.me/s/<канал>`).
 *
 * Навіщо: зеркало ГПВ — не єдине джерело правди для всієї країни. Для частини областей
 * (`dnipro-cek`, `dnipro-dnem`, `ivano-frankivska-oblast` та ін.) воно або не віддає область, або
 * віддає лише найближчі дати, і людина бачить «Немає даних» там, де оператор графік опублікував.
 * Оператори ж пишуть зміни ГПВ у відкритих каналах, без токена бота, наприклад:
 *   «🕗 З 16:40 до 18:30 додатково відключається черга 6/2.»
 *   «🕗 До 15:00 додатково відключаються черга 2/2.»
 * Це відкриті дані без персональної інформації, тому вони законно наповнюють `schedule_slots`.
 *
 * Обмеження, яке треба знати: у каналах публікують ЗМІНИ («додатково відключається»), а не повний
 * добовий ГПВ на всі черги. Тому це доповнення до зеркала: у кроні телеграм-слоти пишуться лише
 * за ті (область, дата), де зеркало не дало нічого (див. `importTelegramSchedules` у index.ts).
 *
 * Розбір тексту тут — ТОЧНА копія перевіреного на живому каналі коду
 * `apps/api/src/services/telegram-schedule.service.ts` (тести: `apps/api/tests/services/telegram-schedule.test.ts`).
 * Два сервери мусять читати один і той самий пост однаково: інакше той самий текст давав би різний
 * графік на Node-бекенді та на Cloudflare-сборці, а людина не зрозуміла б, кому вірити.
 */

/** Джерело в `schedule_slots.source`: за ним видно, звідки взялися слоти. */
export const TELEGRAM_SCHEDULE_SOURCE = 'telegram';

/**
 * Стан «відключення» в легенді оператора (код 3, `Відключення`, `#E33535`) — той самий, що
 * `OFF_STATE` у index.ts і `OFF_STATE_CODE` у вебі. Своїх кодів не вигадуємо.
 */
export const TELEGRAM_OFF_STATE = { code: 3 as const, name: 'Відключення', color: '#E33535' };

export type TelegramScheduleSlot = { queue: string; date: string; timeFrom: string; timeTo: string };

/**
 * Канал → область, для якої він публікує ГПВ.
 *
 * Заповнено лише там, де відповідність перевірена: канал ДТЕК ЦЕК (Дніпро), Прикарпаттяобленерго та
 * Чернігівобленерго. Додавати канал без перевірки не можна: чужий ГПВ на нашій області — це
 * вигаданий графік, а він гірший за чесний EmptyState.
 */
export const TELEGRAM_SCHEDULE_CHANNELS: Array<{ channel: string; region: string }> = [
  { channel: 'chernigivoblenergo', region: 'chernihivska-oblast' },
  { channel: 'cek_info', region: 'dnipro-cek' },
  { channel: 'prykarpattyaoblenergo_official', region: 'ivano-frankivska-oblast' },
];

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

/**
 * Тексти, які означають «графіки не діють» — тобто за цю добу відключень за ГПВ немає.
 *
 * Це таке саме важливе повідомлення, як і графік: без нього «Немає даних» виглядає як поломка, хоча
 * насправді оператор прямо написав, що обмежень немає (перевірено на
 * `prykarpattyaoblenergo_official`: «На Прикарпатті графіки наразі НЕ застосовуються»).
 * Перевірка навмисно вимагає І слова про графік/обмеження, І заперечення поруч (у межах речення):
 * інакше «графіки застосовуються» випадково читалося б як «не застосовуються».
 */
const ALL_CLEAR_RES: RegExp[] = [
  /графік[\p{L}]*[^.!?]{0,60}?\bне\s+(?:застосов|ввод|ді|використ|будуть)/iu,
  /\bне\s+(?:застосов|ввод|ді)[^.!?]{0,60}?графік/iu,
  /обмеженн[\p{L}]*[^.!?]{0,40}?\bне\s+(?:застосов|ввод|передбач)/iu,
  /графік[\p{L}]*[^.!?]{0,40}?(?:скасова|відмінено|знято)/iu,
  /без\s+обмежень/iu,
];

/** Фізичне пошкодження мережі / знеструмлення — аварія, а не плановий графік. */
const EMERGENCY_RE = /аварійн[\p{L}]*|знеструмлен|пошкоджен|обрив/iu;
/** Ремонтні (планові) роботи по адресах. */
const REPAIR_RE = /ремонтн[\p{L}]*\s*(?:робіт|відключен)|планов[\p{L}]*\s*(?:робіт|відключен)/iu;

/** Київська дата YYYY-MM-DD для моменту часу (та сама логіка, що в Node-бекенді). */
export function kyivDateOf(moment: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(moment);
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
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.queue.localeCompare(b.queue) ||
      minutesOf(a.timeFrom) - minutesOf(b.timeFrom),
  );
}

/**
 * Чи повідомляє пост, що графіки за цю добу НЕ діють.
 *
 * Тільки для каналів конкретної області: національні канали («у частині регіонів обмеження
 * застосовуються») дали б хибне «все добре» для кожної області окремо.
 */
export function isAllClearNotice(text: string): boolean {
  return ALL_CLEAR_RES.some((re) => re.test(text));
}

/**
 * Тип точкового відключення за текстом поста: `emergency` (аварія/знеструмлення), `repair`
 * (ремонтні роботи по адресах) або `null` — коли пост про ГПВ/режим і точкової події в ньому немає.
 *
 * Порядок як у Node-бекенді (`outageCategoryFromReason`): аварія сильніша за ремонт.
 */
export function classifyOutagePost(text: string): 'emergency' | 'repair' | null {
  if (EMERGENCY_RE.test(text)) return 'emergency';
  if (REPAIR_RE.test(text)) return 'repair';
  return null;
}

/**
 * Перший явний часовий інтервал поста (`10:00-14:00`, `до 15:00`) у локальному часі оператора.
 *
 * Потрібен для точкових подій: без явного часу ми НЕ вигадуємо тривалість («десь дві години») —
 * краще не показати подію, ніж показати вигадане вікно.
 */
export function firstTimeWindow(text: string): { timeFrom: string; timeTo: string } | null {
  for (const match of text.matchAll(RANGE_RE)) {
    const from = normalizeTime(match[1]!);
    const to = normalizeTime(match[2]!);
    if (from && to && from !== to) return { timeFrom: from, timeTo: to };
  }
  for (const match of text.matchAll(UNTIL_RE)) {
    const to = normalizeTime(match[1]!);
    if (to && to !== '00:00') return { timeFrom: '00:00', timeTo: to };
  }
  return null;
}
