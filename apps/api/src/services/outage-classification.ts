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
