const INCIDENT_REASON =
  /виконання ремонтних робіт|ремонтн.{0,30}робіт|технічн.{0,30}обслугов|пошкоджен.{0,30}(?:мереж|ліні|обладнан)/iu;
const REPAIR_INCIDENT = /ремонтн.{0,30}робіт|технічн.{0,30}обслугов|виконання ремонтних робіт/iu;
const INCIDENT_TITLE = /ремонт|аварі|пошкоджен|знеструм|відновлен|обмеженн.{0,25}споживан/iu;
const NEWS_REGION = /чернігів(?:ська|ської|щин|щині|щини)|сум(?:ська|ської|щин|щині|щини)/iu;

/**
 * Повідомлення про режим/графік (ГАВ, погодинні відключення) — це НЕ аварія:
 * у них немає ні конкретного місця, ні причини. Через слово «аварійних» вони
 * раніше потрапляли на сторінку «Аварії» й виглядали як дублікати.
 */
const REGIME_NOTICE =
  /графік(?:а|и|у)?\s+аварійних\s+відключень|графік(?:а|и|у)?\s+погодинних\s+відключень|годинних\s+відключень|черг(?:а|и|у)?\s+(?:графіка|гав)|застосовано\s+\d+\s+черг|додатково\s+застосовано|\bГАВ\b/iu;

export function isRegimeNotice(text: string | null | undefined): boolean {
  return REGIME_NOTICE.test(text ?? '');
}


export function isRepairIncident(reason: string | null | undefined): boolean {
  return REPAIR_INCIDENT.test(reason ?? '');
}

export function isOutageIncident(reason: string | null | undefined): boolean {
  return INCIDENT_REASON.test(reason ?? '');
}

export function shouldShowIncident(text: string): boolean {
  return INCIDENT_TITLE.test(text) || REPAIR_INCIDENT.test(text);
}

export function shouldKeepRegionalIncident(title: string, description: string): boolean {
  const content = `${title} ${description}`;
  return NEWS_REGION.test(content) && INCIDENT_TITLE.test(content);
}

/** Категорія події за причиною — ЄДИНЕ місце класифікації (invariant 3 у skills/outage-data-core):
 *  колонка outage_events.category заповнюється на ingest/backfill саме цією функцією, а веб лише
 *  показує значення (регекси дублювались у web/lib/outage-location.ts). */
export type OutageEventCategory = 'emergency' | 'repair' | 'regime' | 'planned' | 'other';

/** Фізичне пошкодження мережі — найсильніша ознака аварії, тому перевіряється першою. */
const EMERGENCY_DAMAGE = /пошкоджен|аварі[яй]|знеструмлен|обрив/iu;
/** Заходи обмеження / режимні відключення: «Заходи обмеження», ГАВ, графіки погодинних відключень. */
const REGIME_RESTRICTION = /заход.{0,15}обмеженн|обмеженн.{0,25}споживан|режимн.{0,20}відключенн/iu;
/** Планові роботи та графіки (не аварія). */
const PLANNED_WORK = /планов|погодинн|графік/iu;

/**
 * Категорія події. Порядок перевірок (важливий для змішаних текстів):
 * аварія (пошкодження) → режим/обмеження → ремонт → планове → other.
 * 'other' ніколи не викидається silently: викликач (backfill/ingest) логує причину з warn.
 */
export function outageCategoryFromReason(reason: string | null | undefined): OutageEventCategory {
  const text = (reason ?? '').trim();
  if (!text) return 'other';
  if (EMERGENCY_DAMAGE.test(text)) return 'emergency';
  if (isRegimeNotice(text) || REGIME_RESTRICTION.test(text)) return 'regime';
  if (isRepairIncident(text)) return 'repair';
  if (PLANNED_WORK.test(text)) return 'planned';
  return 'other';
}
