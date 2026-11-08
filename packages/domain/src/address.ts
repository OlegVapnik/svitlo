/**
 * Адреса й номери будинків — правила, які мусять збігатися на сервері й у клієнті.
 *
 * Раніше ці функції жили двома копіями: `cf-worker/src/address.ts` (пошук у D1, порт
 * `energy_normalize_address` з PostgreSQL) і `packages/core/src/lib/address.ts` (пошук по
 * статичних паках на клієнті). Копії були побайтово однакові, але їх ніщо не тримало разом:
 * виправлення в одній означало «адреса знаходиться в онлайні й не знаходиться в паках».
 * Тепер правило одне, а обидва модулі лише реекспортують його.
 *
 * Нічого, крім рядків: жодного SQL, I/O чи залежностей від рантайму.
 */

/** Розбір числової частини номера будинку: «14А» → 14, «12/3» → 12. */
export function parseHouseNumber(raw: string): number | null {
  const match = String(raw ?? '').trim().match(/^(\d{1,5})/u);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) ? value : null;
}

/** Кирилічні омоглифи латинських літер: «100А» і «100A» — один будинок. */
const HOUSE_HOMOGLYPHS: Record<string, string> = {
  а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', і: 'i', ї: 'i', к: 'k',
  м: 'm', о: 'o', р: 'p', т: 't', х: 'x', у: 'y',
};

/** Канонічний ключ будинку: «100/А», «100а», «100 А», «100-А», «100A» → «100a». */
export function normalizeHouseNumber(raw: string): string {
  let value = String(raw ?? '').normalize('NFKC').trim().toLowerCase();
  value = value.replace(/[а-яіїє]/gu, (char) => HOUSE_HOMOGLYPHS[char] ?? char);
  value = value.replace(/\s+/gu, '').replace(/[-–—]+/gu, '');
  value = value.replace(/^(\d+)\/([a-z])$/u, '$1$2');
  return value.replace(/[^0-9a-z/]/gu, '');
}

/**
 * Чи підпадає номер будинку під шаблон прив'язки.
 *
 * Шаблони з реальних вигрузок: `*`, `12`, `2, 4, 6А`, `1-19`. Порівнюються канонічні ключі,
 * тому розкладка літери й роздільник не важливі. Діапазон перевіряємо за числом, а не рядком.
 */
export function matchHouseNumber(houseInput: string, pattern: string): boolean {
  const trimmedPattern = String(pattern ?? '').trim();
  if (trimmedPattern === '' || trimmedPattern === '*') return true;

  const house = parseHouseNumber(houseInput);
  if (house === null) return false;
  const houseKey = normalizeHouseNumber(houseInput);

  for (const rawPart of trimmedPattern.split(',')) {
    const part = rawPart.trim();
    if (part === '' || part === '*') return true;

    // Роздільники всіх трьох типів: у вигрузках трапляються різні.
    const range = part.match(/^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/u);
    if (range) {
      const first = Number.parseInt(range[1]!, 10);
      const second = Number.parseInt(range[2]!, 10);
      // «19-1» трактуємо як перевпорядкований діапазон, інакше він мовчки не збігся б
      // із жодним будинком і виглядав би як «прив'язки немає».
      const [low, high] = first <= second ? [first, second] : [second, first];
      if (house >= low && house <= high) return true;
      continue;
    }

    if (normalizeHouseNumber(part) === houseKey) return true;
  }
  return false;
}

/**
 * Одночасна заміна кирилічних літер — точний аналог `translate(..., 'ыэёїи', 'иееіі')`.
 *
 * Саме одночасна: якщо робити `.replace()` п'ять разів підряд, то `ы` → `и` на першому кроці
 * перетвориться на `і` на останньому, і результат розійдеться з PostgreSQL. Таблиця
 * замінюється одним проходом по регулярці.
 */
const LETTER_MAP: Record<string, string> = { 'ы': 'и', 'э': 'е', 'ё': 'е', 'ї': 'і', 'и': 'і' };

/**
 * Ключ зіставлення адреси. Повторює `energy_normalize_address` з PostgreSQL:
 *
 *   1. lower + одночасна заміна «ы э ё ї и» → «и е е і і»;
 *   2. вирізання пунктуації;
 *   3. зняття ведучого префікса на кшталт «вул.», «проспект», «с.».
 *
 * Порядок кроків важливий: префікс знімається вже без точки, інакше «с. Деснянське» не
 * збіглося б із «с. Деснянское».
 *
 * ВІДМІННІСТЬ ВІД PG (навмисна): оригінал після заміни пунктуації на пробіл лишає подвійні
 * пробіли («м. Дніпро» → «м  дніпро»), тут вони схлопуються в один. Порівняння завжди йдуть
 * «JS-нормалізація проти JS-нормалізації», тож схлопування не ламає пошук, зате ключі
 * читабельніші й не плодять дублікати. Звірено з живою функцією PostgreSQL на 13 варіантах.
 */
export function normalizeAddress(raw: string): string {
  let value = String(raw ?? '')
    .toLowerCase()
    .replace(/[ыэёїи]/gu, (char) => LETTER_MAP[char] ?? char);

  value = value.replace(/[[\]{}()<>,.;:"'`«»/\\|!?*_+%$#@~^&=—–-]/gu, ' ');
  value = value.replace(/\s+/gu, ' ').trim();

  value = value.replace(
    /^(вулиця|вул|улица|ул|проспект|просп|провулок|пров|переулок|пер|село|с\.?)\s+/u,
    '',
  );

  return value.trim();
}
