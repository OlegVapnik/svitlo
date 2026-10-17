/**
 * Киевское время без ICU / Intl.
 *
 * На бесплатном тарифе лимит CPU воркера — 10 мс на запрос. `Intl.DateTimeFormat` +
 * `formatToParts` на сотнях слотов давали 503 (`error 1102`), поэтому здесь та же самая
 * арифметика летнего времени, что была в `index.ts`, но в отдельном модуле: её используют и
 * парсер зеркала, и маршруты (`/status`, `/reliability`, `/sync`).
 */

/**
 * Момент перевода часов: последнее воскресенье месяца (0 — январь) в 01:00 UTC.
 *
 * Украина переходит на летнее время в последнее воскресенье марта в 03:00 по местному (01:00 UTC),
 * а возвращается к зимнему — в последнее воскресенье октября в 04:00 по местному (01:00 UTC).
 * Правило действует с 1996 года и не менялось, поэтому его можно считать арифметикой.
 */
function lastSundayOneUtc(year: number, monthIndex: number): number {
  const lastDayOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0));
  const day = lastDayOfMonth.getUTCDate() - lastDayOfMonth.getUTCDay();
  return Date.UTC(year, monthIndex, day, 1, 0, 0);
}

/**
 * Границы летнего времени по годам (последнее воскресенье марта и октября) и последний
 * использованный год: слоты одного ответа лежат в одном-двух годах, а `lastSundayOneUtc` — это
 * `new Date` на каждую границу.
 */
const KYIV_DST_BOUNDS = new Map<number, [number, number]>();

/** Год, для которого уже посчитаны границы, вместе с его началом и концом в UTC. */
let kyivYearCache = { year: 0, start: 0, end: 0 };

/** Сдвиг Киева относительно UTC в минутах: +120 зимой, +180 летом. */
export function kyivOffsetMinutesAt(ms: number): number {
  // Границы летнего времени ищем один раз на год и запоминаем: `lastSundayOneUtc` строит `Date`,
  // а `localSlotToUtc` спрашивает сдвиг до трёх раз на каждую границу слота — на месяце слотов
  // это тысячи лишних `Date` в горячем пути `/reliability` и `/status`.
  let year = kyivYearCache.year;
  if (year === 0 || ms < kyivYearCache.start || ms >= kyivYearCache.end) {
    year = new Date(ms).getUTCFullYear();
    const bounds =
      KYIV_DST_BOUNDS.get(year) ?? [lastSundayOneUtc(year, 2), lastSundayOneUtc(year, 9)];
    KYIV_DST_BOUNDS.set(year, bounds);
    kyivYearCache = { year, start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
  }
  const bounds = KYIV_DST_BOUNDS.get(year)!;
  return ms >= bounds[0] && ms < bounds[1] ? 180 : 120;
}

/** Сегодняшняя дата по Киеву (`YYYY-MM-DD`) с учётом летнего времени. */
export function kyivToday(): string {
  const now = Date.now();
  return new Date(now + kyivOffsetMinutesAt(now) * 60_000).toISOString().slice(0, 10);
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
export function localSlotToUtc(date: string, time: string, end: boolean): string {
  if (end && time === '00:00') {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    const nextMidnight = Date.parse(`${nextDate}T00:00:00Z`);
    return new Date(nextMidnight - kyivOffsetMinutesAt(nextMidnight) * 60_000).toISOString();
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Сдвиг ищем сходимостью, но без ICU: на каждом проходе сравниваем «желаемое» локальное время с
  // тем, которое даёт текущая догадка, и сдвигаем её на разницу. Это ровно тот же алгоритм, что был
  // здесь на `Intl`/`formatToParts`, только представление локального времени считается арифметикой
  // (3 прохода по числу). В час перевода стрелок локальное время неоднозначно; сохраняем прежний
  // выбор — тот, к которому приводила итерация с `Intl`, чтобы уже отданные интервалы не поехали.
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const wallClock = guess + kyivOffsetMinutesAt(guess) * 60_000;
    const delta = target - wallClock;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}

/**
 * Київське «дата + час» в UTC-миллисекунды — тот же расчёт, что у `localSlotToUtc`.
 *
 * Отдельная функция нужна из-за цены строк: `localSlotToUtc` строит ISO-строку, а вызывающий её тут
 * же разбирает `Date.parse`. В отчёте надёжности это по два преобразования на каждую границу каждого
 * слота (месяц × группы × 2), то есть миллисекунды CPU на пустом месте. `end && time === '00:00'` —
 * полночь СЛЕДУЮЩЕГО дня: так зеркало записывает «до конца суток».
 */
export function kyivWallClockMs(date: string, time: string, end: boolean): number {
  const wallMs =
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      Number(time.slice(0, 2)),
      Number(time.slice(3, 5)),
    ) + (end && time === '00:00' ? 86_400_000 : 0);
  // Сходимость та же, что в `localSlotToUtc`: сравниваем желаемое локальное время с тем, которое
  // даёт текущая догадка, и сдвигаем её на разницу.
  let guess = wallMs;
  for (let i = 0; i < 3; i += 1) {
    const delta = wallMs - (guess + kyivOffsetMinutesAt(guess) * 60_000);
    if (!delta) break;
    guess += delta;
  }
  return guess;
}

/** 48 получасовых подписей суток: `00:00`, `00:30`, … `23:30`. */
export function halfHourLabels(): string[] {
  return Array.from({ length: 48 }, (_, index) =>
    `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
  );
}
