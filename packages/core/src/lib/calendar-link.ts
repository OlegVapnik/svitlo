/**
 * Посилання на календар із графіком відключень.
 *
 * Користувач не повинен щоразу відкривати застосунок, щоб дізнатися, чи буде світло. Тому
 * віддаємо два варіанти того самого посилання:
 *  - `https://…/api/v1/calendar.ics` — для копіювання в Google Calendar («Додати за URL»);
 *  - `webcal://…` — відкриває системний календар на iOS/macOS одним тапом.
 *
 * Область і черга — частина шляху запиту, а не стану на сервері: календар у людини має бути
 * привʼязаний до її черги, навіть якщо вона перемикалася в застосунку.
 */

/** Базовий URL API: без слеша в кінці, щоб не збирати подвійні `//`. */
function trimBase(apiBase: string): string {
  return apiBase.replace(/\/+$/u, '');
}

/** Відносний шлях календаря: область і черга кодуються, бо `/` у `2/2` — частина значення. */
export function calendarIcsPath(region: string, queue: string): string {
  const params = new URLSearchParams({ region, queue });
  return `/api/v1/calendar.ics?${params.toString()}`;
}

/** `https://host/api/v1/calendar.ics?region=…&queue=…` — для копіювання в календар. */
export function calendarIcsUrl(apiBase: string, region: string, queue: string): string {
  return `${trimBase(apiBase)}${calendarIcsPath(region, queue)}`;
}

/** `webcal://host/…` — той самий ресурс, але одразу для системного календаря. */
export function calendarWebcalUrl(apiBase: string, region: string, queue: string): string {
  const base = trimBase(apiBase).replace(/^https?:\/\//u, '');
  return `webcal://${base}${calendarIcsPath(region, queue)}`;
}
