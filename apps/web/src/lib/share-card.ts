import type { ScheduleIntervalUtc } from '@svitlo/shared';
import { OFF_STATE_CODE, kyivOffset, minutesOfDay, minutesToHm } from './scheduleWindow.js';
import { UNCERTAIN_STATE_CODE } from './power-windows.js';
import { kyivDateKey } from './outage-dates.js';

/**
 * Картка графіка у PNG (1080×1350) для Telegram/Viber.
 *
 * Навіщо картинка, а не текст. Текстовий графік у месенджері розсипається на рядки й губить
 * головне — коли саме немає світла. Одна картинка читається з екрана телефона без відкриття
 * застосунку, її можна переслати батькам одним дотиком і вона однаково виглядає в обох.
 *
 * Чому canvas, а не html2canvas. Залежність на 200+ kB заради однієї картки неприйнятна: у
 * застосунку кожен кілобайт стартового чанка — це секунди на слабкому мобільному інтернеті під
 * час відключення. Canvas є в браузері й у WebView, малює синхронно й не тягне нічого.
 *
 * Тексти передаються ззовні (`labels`): у lib не повинно бути зашитих українських рядків, інакше
 * вони не потраплять у `uk.json` і не перевірятимуться разом з рештою інтерфейсу.
 */

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

const COLORS = {
  background: '#09090B',
  panel: '#121216',
  panelBorder: '#27272A',
  text: '#FAFAFA',
  muted: '#A1A1AA',
  faint: '#71717A',
  track: '#1C1C21',
  on: '#10B981',
  off: '#F43F5E',
  uncertain: '#F59E0B',
  hairline: '#3F3F46',
};

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Подписи карточки: приходят из i18n компонента, чтобы в lib не было текста интерфейса. */
export interface ShareCardLabels {
  title: string;
  queue: string;
  outages: string;
  empty: string;
  now: string;
  footer: string;
  updated: string;
  more: (count: number) => string;
}

export interface ShareCardInput {
  queue: string;
  regionName: string;
  date: string;
  intervals: ScheduleIntervalUtc[];
  allClear?: boolean;
  labels: ShareCardLabels;
  generatedAt?: Date;
}

/** Відрізок на шкалі картки. */
export interface CardSegment {
  from: number;
  to: number;
  tone: 'off' | 'uncertain';
}

/**
 * Відрізки, які треба намалювати на шкалі: відключення та «можливо вимкнуть».
 * Світло не малюємо окремо — воно й так фон шкали.
 */
export function cardSegments(intervals: readonly ScheduleIntervalUtc[], date: string): CardSegment[] {
  const segments: CardSegment[] = [];
  for (const interval of intervals) {
    if (interval.stateCode !== OFF_STATE_CODE && interval.stateCode !== UNCERTAIN_STATE_CODE) continue;
    const from = minutesOfDay(interval.startsAt, date);
    const to = minutesOfDay(interval.endsAt, date);
    if (to > from) segments.push({ from, to, tone: interval.stateCode === OFF_STATE_CODE ? 'off' : 'uncertain' });
  }
  return segments.sort((left, right) => left.from - right.from);
}

/** Отключения для списка под шкалой: только реальные (код 3), по порядку. */
export function cardOutages(intervals: readonly ScheduleIntervalUtc[], date: string): CardSegment[] {
  return intervals
    .filter((interval) => interval.stateCode === OFF_STATE_CODE)
    .map((interval) => ({ from: minutesOfDay(interval.startsAt, date), to: minutesOfDay(interval.endsAt, date), tone: 'off' as const }))
    .filter((segment) => segment.to > segment.from)
    .sort((left, right) => left.from - right.from);
}

/** Дата карточки по-украински: «17 жовтня 2026 р.» — месяцы берём из Intl, не из своих таблиц. */
export function cardDateLabel(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** «14:32» по Киеву — подпись времени изготовления карточки. */
export function cardGeneratedLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

/** Длительность сегмента по-украински: «4 год», «1 год 30 хв». */
function durationLabel(minutes: number): string {
  const value = Math.max(0, Math.round(minutes));
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours === 0) return `${rest} хв`;
  return rest === 0 ? `${hours} год` : `${hours} год ${rest} хв`;
}

type RoundRectContext = CanvasRenderingContext2D & {
  roundRect?: (x: number, y: number, width: number, height: number, radii: number | number[]) => void;
};

function setFont(ctx: CanvasRenderingContext2D, size: number, weight = 400): void {
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
}

/** Обрезает строку по ширине: длинное название области не должно выезжать за карточку. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result.trimEnd()}…`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  const capable = ctx as RoundRectContext;
  if (typeof capable.roundRect === 'function') {
    capable.roundRect(x, y, width, height, radius);
    return;
  }
  // Фолбэк для WebView без ctx.roundRect: тот же контур вручную.
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + width, y + height - r);
  ctx.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + height);
  ctx.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** «Зараз» в минутах киевских суток карточки; null — карточка не на сегодня. */
function nowMinutesFor(date: string, now: Date): number | null {
  if (date !== kyivDateKey(now)) return null;
  const dayStartMs = Date.parse(`${date}T00:00:00Z`) - kyivOffset(date) * 60_000;
  const minutes = Math.round((now.getTime() - dayStartMs) / 60_000);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  // Мягкое изумрудное свечение сверху: акцент Obsidian Dark без второго цвета палитры.
  const glow = ctx.createLinearGradient(0, 0, 0, 520);
  glow.addColorStop(0, 'rgba(16,185,129,0.16)');
  glow.addColorStop(1, 'rgba(9,9,11,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, 520);
}

function drawHeader(ctx: CanvasRenderingContext2D, input: ShareCardInput): void {
  const left = 80;
  const right = CARD_WIDTH - 80;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  setFont(ctx, 30, 800);
  ctx.fillStyle = COLORS.text;
  ctx.fillText('SVITLO', left, 112);

  setFont(ctx, 22, 600);
  ctx.fillStyle = COLORS.faint;
  ctx.fillText(input.labels.title.toUpperCase(), left, 158);

  ctx.textAlign = 'right';
  setFont(ctx, 26, 500);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(cardDateLabel(input.date), right, 112);

  // Чип со числом отключений: главный ответ карточки виден раньше, чем шкала.
  const outages = cardOutages(input.intervals, input.date);
  const chipText = outages.length > 0 ? `${outages.length} ${input.labels.outages.toLowerCase()}` : input.labels.empty;
  setFont(ctx, 22, 600);
  const chipWidth = Math.min(560, ctx.measureText(chipText).width + 48);
  ctx.fillStyle = outages.length > 0 ? 'rgba(244,63,94,0.16)' : 'rgba(16,185,129,0.16)';
  roundRectPath(ctx, right - chipWidth, 136, chipWidth, 46, 23);
  ctx.fill();
  ctx.fillStyle = outages.length > 0 ? COLORS.off : COLORS.on;
  ctx.textAlign = 'center';
  ctx.fillText(fitText(ctx, chipText, chipWidth - 40), right - chipWidth / 2, 167);

  // Область и очередь: два самых крупных элемента, их читают с уменьшенного превью.
  ctx.textAlign = 'left';
  setFont(ctx, 52, 700);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fitText(ctx, input.regionName, 760), left, 272);

  setFont(ctx, 22, 600);
  ctx.fillStyle = COLORS.faint;
  ctx.fillText(input.labels.queue.toUpperCase(), left, 330);

  setFont(ctx, 112, 800);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fitText(ctx, input.queue, 420), left, 446);
}

function drawTimeline(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  segments: readonly CardSegment[],
  now: Date,
): void {
  const panelX = 80;
  const panelY = 500;
  const panelWidth = CARD_WIDTH - 160;
  const panelHeight = 230;

  ctx.fillStyle = COLORS.panel;
  roundRectPath(ctx, panelX, panelY, panelWidth, panelHeight, 28);
  ctx.fill();
  ctx.strokeStyle = COLORS.panelBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  const trackX = 120;
  const trackY = 570;
  const trackWidth = CARD_WIDTH - 240;
  const trackHeight = 64;

  ctx.fillStyle = COLORS.track;
  roundRectPath(ctx, trackX, trackY, trackWidth, trackHeight, 16);
  ctx.fill();

  // Свет — базовая заливка шкалы, поверх неё только «нет света»: так видно и окна, и их доли.
  ctx.save();
  roundRectPath(ctx, trackX, trackY, trackWidth, trackHeight, 16);
  ctx.clip();
  ctx.fillStyle = 'rgba(16,185,129,0.35)';
  ctx.fillRect(trackX, trackY, trackWidth, trackHeight);
  for (const segment of segments) {
    const left = trackX + (segment.from / (24 * 60)) * trackWidth;
    const width = Math.max(2, ((segment.to - segment.from) / (24 * 60)) * trackWidth);
    ctx.fillStyle = segment.tone === 'off' ? COLORS.off : COLORS.uncertain;
    ctx.fillRect(left, trackY, width, trackHeight);
  }
  ctx.restore();

  // Разметка часов: те же 00/06/12/18/24, что и в приложении, чтобы карточка читалась так же.
  setFont(ctx, 22, 600);
  ctx.fillStyle = COLORS.faint;
  ctx.textBaseline = 'top';
  for (const mark of [0, 360, 720, 1080, 1440]) {
    const px = trackX + (mark / (24 * 60)) * trackWidth;
    ctx.textAlign = mark === 0 ? 'left' : mark === 1440 ? 'right' : 'center';
    ctx.fillText(minutesToHm(mark), px, trackY + trackHeight + 18);
  }
  ctx.textBaseline = 'alphabetic';

  // Линия «зараз» — только для карточки на сегодня: на завтра она была бы враньём.
  const nowMinutes = nowMinutesFor(input.date, now);
  if (nowMinutes != null) {
    const px = trackX + (nowMinutes / (24 * 60)) * trackWidth;
    ctx.fillStyle = 'rgba(250,250,250,0.9)';
    ctx.fillRect(px - 1.5, trackY - 12, 3, trackHeight + 24);
    ctx.beginPath();
    ctx.arc(px, trackY - 12, 6, 0, Math.PI * 2);
    ctx.fill();

    setFont(ctx, 22, 600);
    ctx.fillStyle = COLORS.text;
    const alignRight = px > trackX + trackWidth - 160;
    ctx.textAlign = alignRight ? 'right' : 'left';
    ctx.fillText(`${input.labels.now} ${minutesToHm(nowMinutes)}`, alignRight ? px - 12 : px + 12, trackY - 22);
    ctx.textAlign = 'left';
  }
}

function drawOutages(ctx: CanvasRenderingContext2D, input: ShareCardInput, outages: readonly CardSegment[]): void {
  const left = 80;
  const right = CARD_WIDTH - 80;

  setFont(ctx, 22, 700);
  ctx.fillStyle = COLORS.faint;
  ctx.textAlign = 'left';
  ctx.fillText(input.labels.outages.toUpperCase(), left, 800);

  if (outages.length === 0) {
    setFont(ctx, 36, 500);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(fitText(ctx, input.labels.empty, CARD_WIDTH - 160), left, 872);
    return;
  }

  const maxRows = 6;
  let y = 872;
  for (const segment of outages.slice(0, maxRows)) {
    ctx.fillStyle = COLORS.off;
    ctx.beginPath();
    ctx.arc(left + 8, y - 11, 8, 0, Math.PI * 2);
    ctx.fill();

    setFont(ctx, 36, 600);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`${minutesToHm(segment.from)} – ${minutesToHm(segment.to)}`, left + 36, y);

    setFont(ctx, 30, 500);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(durationLabel(segment.to - segment.from), right, y);
    ctx.textAlign = 'left';
    y += 64;
  }

  if (outages.length > maxRows) {
    setFont(ctx, 26, 500);
    ctx.fillStyle = COLORS.faint;
    ctx.fillText(input.labels.more(outages.length - maxRows), left + 36, y);
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, input: ShareCardInput, now: Date): void {
  const left = 80;
  const right = CARD_WIDTH - 80;

  ctx.fillStyle = COLORS.hairline;
  ctx.fillRect(left, 1215, CARD_WIDTH - 160, 2);

  setFont(ctx, 28, 600);
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText(input.labels.footer, left, 1282);

  setFont(ctx, 24, 500);
  ctx.fillStyle = COLORS.faint;
  ctx.textAlign = 'right';
  ctx.fillText(`${input.labels.updated} ${cardGeneratedLabel(now)}`, right, 1282);
  ctx.textAlign = 'left';
}

/** Рисует карточку в готовый 2D-контекст (экспортировано для повторного использования). */
export function drawScheduleCard(ctx: CanvasRenderingContext2D, input: ShareCardInput): void {
  const now = input.generatedAt ?? new Date();
  drawBackground(ctx);
  drawHeader(ctx, input);
  drawTimeline(ctx, input, cardSegments(input.intervals, input.date), now);
  drawOutages(ctx, input, cardOutages(input.intervals, input.date));
  drawFooter(ctx, input, now);
}

/** Собирает PNG-карточку 1080×1350. Бросает, если canvas недоступен или не смог закодировать PNG. */
export async function buildScheduleCardPng(input: ShareCardInput): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('canvas unavailable');
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  drawScheduleCard(ctx, input);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('png encoding failed');
  return blob;
}

/** Итог попытки поделиться: что именно увидел человек. */
export type ShareCardResult = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/** Имя файла без «/» из кода очереди: «svitlo-2026-10-17-2-2.png». */
export function shareCardFileName(input: Pick<ShareCardInput, 'date' | 'queue'>): string {
  return `svitlo-${input.date}-${input.queue.replace(/[^a-zA-Z0-9]+/g, '-')}.png`;
}

function downloadBlob(blob: Blob, fileName: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Делится карточкой: сначала системное меню с файлом (Telegram/Viber/пошта), а если платформа
 * файлы не умеет — скачивает PNG. «Скачано» — это не ошибка: на компьютере это и есть цель.
 */
export async function shareScheduleCard(input: ShareCardInput): Promise<ShareCardResult> {
  let blob: Blob;
  try {
    blob = await buildScheduleCardPng(input);
  } catch {
    return 'failed';
  }

  const fileName = shareCardFileName(input);

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File([blob], fileName, { type: 'image/png' });
      const supported = typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : true;
      if (supported) {
        await navigator.share({ files: [file], title: input.labels.title });
        return 'shared';
      }
    } catch (error) {
      // Закрытое системное меню — не ошибка и не повод скачивать файл без просьбы.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Всё остальное (нет права на файл, отказ платформы) уводим в скачивание.
    }
  }

  return downloadBlob(blob, fileName) ? 'downloaded' : 'failed';
}

