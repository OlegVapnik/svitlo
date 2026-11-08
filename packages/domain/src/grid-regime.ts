/**
 * Класифікатор режимів енергосистеми за термінологією ДТЕК / НЕК «Укренерго».
 *
 * Навіщо окремий домен: у стрічці новин ті самі слова означають різні речі.
 *   - ГАВ/СГАВ — аварійні графіки, коли погодинні черги не діють;
 *   - ГПВ — звичайні стабілізаційні відключення за чергами;
 *   - ГОП/ГОЕ — обмеження потужності/електроенергії для ПРОМИСЛОВОСТІ та бізнесу, не для
 *     побутових споживачів;
 *   - локальна аварія — пошкодження на окремих вулицях, яке не скасовує ГПВ по області.
 *
 * Модуль чистий: жодного I/O, лише текст поста → структурований режим. Це дозволяє
 * використовувати його і у воркері (`/sync`), і в клієнті, і в тестах без мережі.
 */

export type GridRegimeKind =
  | 'SGAV'
  | 'GAV'
  | 'GPV'
  | 'GOP_GOE'
  | 'LOCAL_EMERGENCY'
  | 'CANCELLED';

export type GridRegimeLevel = 'stable' | 'warning' | 'emergency';

export interface GridRegime {
  kind: GridRegimeKind;
  level: GridRegimeLevel;
  /** Коротка назва для банера. */
  titleUk: string;
  /** Пояснення для людини: що це означає для її світла. */
  messageUk: string;
  /** `all` — режим стосується всіх черг; масив — лише згаданих у пості. */
  affectedQueues: 'all' | string[];
  /** Чи стосується це побутових споживачів (для ГОП/ГОЕ — false). */
  householdAffected: boolean;
  /** Чи це аварійний режим, який має перекривати звичайний банер. */
  isEmergency: boolean;
}

export interface GridRegimeSnapshot extends GridRegime {
  /** Коли опубліковано пост, з якого взято режим (ISO), якщо відомо. */
  detectedAt: string | null;
  sourcePostUrl: string | null;
}

export interface GridRegimeSourcePost {
  title?: string | null;
  summary?: string | null;
  body?: string | null;
  publishedAt?: string | null;
  url?: string | null;
}

/** «черга 2/2», «черги 6/2», «чергу 3» — код черги після слова «черга». */
const QUEUE_RE = /черг(?:а|и|і|у|ам|ами)?\s*[№:]?\s*(\d{1,2}(?:\/\d{1,2})?)/giu;

const SGAV_RE =
  /сгав|спеціальн[\p{L}]*\s+графік[\p{L}]*\s+аварійн[\p{L}]*|спеціальн[\p{L}]*\s+графік[\p{L}]*\s+відключен/iu;

/**
 * Скасування — перевіряємо ПЕРШИМ: «ГАВ скасовано, повертаємось до ГПВ» містить і ГАВ, і ГПВ,
 * але фактичний режим — звичайний графік.
 */
const CANCELLED_RE =
  /(?:скасован|відмін|знят|припинен|відбій)[^.!?]{0,80}(?:гав|сгав|аварійн|екстрен)|(?:гав|сгав|аварійн|екстрен)[^.!?]{0,80}(?:скасован|відмін|знят|припинен|відбій)|поверненн[\p{L}]*[^.!?]{0,40}(?:до\s+)?гпв|перехід[^.!?]{0,40}(?:до\s+)?гпв/iu;

/** ГОП/ГОЕ — обмеження для промисловості. Перевіряємо до ГАВ, щоб не лякати побут. */
const GOP_GOE_RE =
  /гоп|гоє|графік[\p{L}]*\s+обмеження\s+потужност|обмеження[\p{L}]*\s+електроенерг|промислов[\p{L}]*|бізнес[\p{L}]*/iu;

const GAV_RE =
  /гав|аварійн[\p{L}]*\s+відключен|екстрен[\p{L}]*\s+відключен|за\s+командою\s+укренерго/iu;

const LOCAL_EMERGENCY_RE =
  /локальн[\p{L}]*\s+авар|точков[\p{L}]*\s+авар|пошкоджен[\p{L}]*\s+мереж|обрив[\p{L}]*\s+мереж|окрем[\p{L}]*\s+вулиц|адресн[\p{L}]*\s+відключен/iu;

const GPV_RE =
  /гпв|графік[\p{L}]*\s+погодинн|погодинн[\p{L}]*\s+відключен|стабілізаційн[\p{L}]*|за\s+розкладом\s+черг/iu;

/** «черги 2/2 та 4/1», «черги 2/2, 4/1» — продовження переліку після першої згадки. */
const QUEUE_CONTINUATION_RE = /(?:та|і|,)\s*(\d{1,2}\/\d{1,2})/giu;

function extractQueues(text: string): string[] {
  const queues = new Set<string>();
  for (const match of text.matchAll(QUEUE_RE)) {
    const queue = match[1]?.trim();
    if (queue) queues.add(queue);
  }
  if (queues.size > 0) {
    for (const match of text.matchAll(QUEUE_CONTINUATION_RE)) {
      const queue = match[1]?.trim();
      if (queue) queues.add(queue);
    }
  }
  return [...queues];
}

function withQueues(regime: Omit<GridRegime, 'affectedQueues'>, text: string, fallback: 'all' | string[]): GridRegime {
  const queues = extractQueues(text);
  return {
    ...regime,
    affectedQueues: queues.length > 0 ? queues : fallback,
  };
}

/**
 * Визначає режим за текстом одного поста.
 *
 * Повертає `null`, якщо пост не про режим мережі (наприклад, просто новина про ремонт дороги):
 * вигадувати «ГПВ» для будь-якого тексту не можна.
 */
/**
 * Чи стосується режим конкретної черги користувача.
 *
 * `affectedQueues: 'all'` — так (аварія по всій області). Масив — лише коли наша черга в ньому.
 * Порожній масив (наприклад, ГОП/ГОЕ без переліку) не означає «всі»: для ГОП це взагалі
 * питання бізнесу, а не черг.
 */
export function gridRegimeAppliesToQueue(
  regime: Pick<GridRegimeSnapshot, 'affectedQueues'>,
  queue: string | null | undefined,
): boolean {
  if (regime.affectedQueues === 'all') return true;
  const code = String(queue ?? '').trim();
  if (!code) return false;
  return regime.affectedQueues.includes(code);
}

/**
 * Що з режиму варто показати на Головній для цієї черги.
 *
 * `null` — банера немає: штатний ГПВ і скасування аварії не потребують окремої плашки, їх
 * показує звичайний статус. ГОП/ГОЕ та локальні аварії показуємо завжди: це контекст, який
 * пояснює, чому графік виглядає не так, як людина очікувала.
 */
export function visibleGridRegime(
  regime: GridRegimeSnapshot | null | undefined,
  queue: string | null | undefined,
): GridRegimeSnapshot | null {
  if (!regime) return null;
  switch (regime.kind) {
    case 'GPV':
    case 'CANCELLED':
      return null;
    case 'GOP_GOE':
      // Плашка про промисловість не потрібна побутовому користувачу: вона займає пів екрана
      // й не змінює його рішення. Лишаємо банер лише для станів, що реально впливають на людей.
      return null;
    case 'LOCAL_EMERGENCY':
      return regime;
    case 'SGAV':
    case 'GAV':
      return gridRegimeAppliesToQueue(regime, queue) ? regime : null;
    default:
      return null;
  }
}

export function classifyGridRegimePost(text: string): GridRegime | null {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return null;

  if (CANCELLED_RE.test(normalized)) {
    return withQueues(
      {
        kind: 'CANCELLED',
        level: 'stable',
        titleUk: 'ГАВ/СГАВ скасовано',
        messageUk: 'Аварійні графіки скасовано — повертаємось до погодинних графіків ГПВ.',
        householdAffected: false,
        isEmergency: false,
      },
      normalized,
      'all',
    );
  }

  if (SGAV_RE.test(normalized)) {
    return withQueues(
      {
        kind: 'SGAV',
        level: 'emergency',
        titleUk: 'СГАВ',
        messageUk: 'Діє спеціальний графік аварійних відключень — погодинні графіки не застосовуються.',
        householdAffected: true,
        isEmergency: true,
      },
      normalized,
      'all',
    );
  }

  if (GOP_GOE_RE.test(normalized)) {
    return withQueues(
      {
        kind: 'GOP_GOE',
        level: 'warning',
        titleUk: 'ГОП/ГОЕ',
        messageUk:
          'Обмеження потужності або електроенергії для промисловості та бізнесу — побутових споживачів не стосується.',
        householdAffected: false,
        isEmergency: false,
      },
      normalized,
      [],
    );
  }

  if (GAV_RE.test(normalized)) {
    return withQueues(
      {
        kind: 'GAV',
        level: 'emergency',
        titleUk: 'ГАВ',
        messageUk: 'Екстрені аварійні відключення за командою Укренерго — графіки ГПВ тимчасово не діють.',
        householdAffected: true,
        isEmergency: true,
      },
      normalized,
      'all',
    );
  }

  if (LOCAL_EMERGENCY_RE.test(normalized)) {
    return withQueues(
      {
        kind: 'LOCAL_EMERGENCY',
        level: 'warning',
        titleUk: 'Локальна аварія',
        messageUk:
          'Пошкодження мережі на окремих вулицях — графік ГПВ по всій області не скасовано.',
        householdAffected: true,
        isEmergency: false,
      },
      normalized,
      [],
    );
  }

  if (GPV_RE.test(normalized)) {
    return withQueues(
      {
        kind: 'GPV',
        level: 'warning',
        titleUk: 'ГПВ',
        messageUk: 'Погодинні відключення за графіком черг.',
        householdAffected: true,
        isEmergency: false,
      },
      normalized,
      'all',
    );
  }

  return null;
}

/**
 * Останній актуальний режим зі стрічки новин.
 *
 * `/sync` уже завантажує новини, тому класифікація не робить жодного додаткового читання D1.
 * Беремо найсвіжіший пост за останні `maxAgeMinutes`; застарілі аварійні банери не показуємо.
 */
export function latestGridRegime(
  posts: readonly GridRegimeSourcePost[],
  options: { now?: number; maxAgeMinutes?: number } = {},
): GridRegimeSnapshot | null {
  const now = options.now ?? Date.now();
  const maxAgeMs = (options.maxAgeMinutes ?? 24 * 60) * 60 * 1000;
  const sorted = [...posts].sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : Number.NaN;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : Number.NaN;
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });

  for (const post of sorted) {
    const publishedAt = post.publishedAt ? Date.parse(post.publishedAt) : Number.NaN;
    if (Number.isFinite(publishedAt) && now - publishedAt > maxAgeMs) continue;
    const text = [post.title, post.summary, post.body].filter(Boolean).join('\n');
    const regime = classifyGridRegimePost(text);
    if (!regime) continue;
    return {
      ...regime,
      detectedAt: Number.isFinite(publishedAt) ? new Date(publishedAt).toISOString() : null,
      sourcePostUrl: post.url ?? null,
    };
  }
  return null;
}
