/**
 * Утиліти форматування новин: очищення емодзі, дедуплікація заголовка/тіла
 * та людські назви джерел (обленерго).
 */

const KNOWN_SOURCES: Record<string, string> = {
  chernigivoblenergo: 'Чернігівобленерго',
  lvivoblenergo: 'Львівобленерго',
  pat_cherkasyoblenergo: 'Черкасиобленерго',
  cherkasyoblenergo: 'Черкасиобленерго',
  oe_if_ua: 'Прикарпаттяобленерго',
  prykkarpattyaoblenergo_official: 'Прикарпаттяобленерго',
  khmoblenergo: 'Хмельницькобленерго',
  sumyoblenergo: 'Сумиобленерго',
  sumyenergo: 'Сумиобленерго',
  poltavaoblenergo: 'Полтаваобленерго',
  zoe_com_ua: 'Запоріжжяобленерго',
  ztoe_com_ua: 'Житомиробленерго',
  zhytomyroblenergo: 'Житомиробленерго',
  ukrenergo: 'Укренерго',
  dtek_ua: 'ДТЕК',
  dtek_krem: 'ДТЕК Київські регіональні електромережі',
  dtek_kem: 'ДТЕК Київські електромережі',
  dtek_dnem: 'ДТЕК Дніпровські електромережі',
  dtek_oem: 'ДТЕК Одеські електромережі',
  cek_info: 'ЦЕК',
  voe_com_ua: 'Вінницяобленерго',
  volynoblenergo: 'Волиньобленерго',
  ksoe_com_ua: 'Херсонобленерго',
  roe_vsei_ua: 'Рівнеобленерго',
  toe_com_ua: 'Тернопільобленерго',
  zakarpatoblenergo: 'Закарпаттяобленерго',
  kiroe_com_ua: 'Кіровоградобленерго',
  mykolaivoblenergo: 'Миколаївобленерго',
  kharkivoblenergo: 'Харківобленерго',
  chernivtsioblenergo: 'Чернівціобленерго',
};

/**
 * Повністю видаляє всі юнікод-емодзі з тексту новин,
 * прибирає пробіли перед розділовими знаками та стискає зайві пробіли.
 */
export function stripNewsEmoji(text: string): string {
  if (!text) return '';
  return text
    // 1. Видаляємо всі емодзі-символи, варіативні селектори та zwnj/zwj
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, '')
    // 2. Прибираємо пробіли перед розділовими знаками (щоб "(ГПВ) ☝️ ." стало "(ГПВ).")
    .replace(/[ \t\r\n]+([.,:;!?—–])/g, '$1')
    // 3. Стискаємо подвійні пробіли до одного
    .replace(/[ \t]+/g, ' ')
    // 4. Нормалізуємо порожні рядки
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Очищує та дедуплікує заголовок і тіло новини для відображення в картці.
 * Якщо тіло дублює заголовок, або коротке, або складається лише з крапок — повертає body: ''.
 */
export function cleanNewsCardContent(
  rawTitle: string,
  rawBody?: string | null,
): { title: string; body: string } {
  const title = stripNewsEmoji(rawTitle || '');
  let body = stripNewsEmoji(rawBody || '');

  // Видаляємо стандартні хвости обленерго з посиланнями на чат-боти та сайти:
  // «Нагадуємо, що перевірити інформацію щодо черг... tg://resolve...»
  body = body
    .replace(
      /(?:\n\s*|\s+|^)(?:🤔\s*)?(?:Нагадуємо,?\s*що\s*перевірити|Перевірити\s*інформацію\s*щодо\s*черг|Дізнатися\s*свою\s*чергу|Ознайомитися\s*з\s*графіком)[\s\S]*$/iu,
      '',
    )
    .replace(
      /(?:\n\s*|\s+|^)(?:🙏\s*)?Як\s*і\s*раніше,?\s*дуже\s*просимо\s*усіх\s*бути\s*максимально\s*ощадливими[\s\S]*$/iu,
      '',
    )
    .trim();

  // Прибираємо висячі \n... або \n… у кінці body
  body = body.replace(/[\r\n\s]+(?:\.{3}|…)\s*$/, '').trim();

  // Очищений заголовок без кінцевих крапок/тире для надійного зіставлення початку
  const titlePrefix = title.replace(/[\s.…\-—–]+$/, '').trim();

  // Якщо body починається з тексту title — відрізаємо title з початку body
  if (titlePrefix && body.startsWith(titlePrefix)) {
    body = body.slice(titlePrefix.length).replace(/^[\s.,:;—–-]+/, '').trim();
  } else if (body.startsWith(title)) {
    body = body.slice(title.length).replace(/^[\s.,:;—–-]+/, '').trim();
  }

  // Якщо після цього body порожній, або складається лише з ..., або коротший за 5 символів, або дорівнює title
  const isDangling = !body || /^[\s.…\-—–]+$/.test(body) || body.length < 5 || body === title || body === titlePrefix;
  if (isDangling) {
    body = '';
  }

  return { title, body };
}

/**
 * Повертає людську назву джерела українською мовою замість сирого handle каналу.
 * Наприклад: 'chernigivoblenergo' -> 'Чернігівобленерго'.
 */
export function formatSourceLabel(sourceKey: string): string {
  if (!sourceKey) return '';
  // Відокремлюємо префікс типу "custom:@channel", "tg:channel", "telegram:channel"
  const rawHandle = sourceKey
    .replace(/^(?:custom|tg|telegram):+/i, '')
    .replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?/i, '')
    .replace(/^@/, '')
    .trim();

  const normalized = rawHandle.toLowerCase();
  if (KNOWN_SOURCES[normalized]) {
    return KNOWN_SOURCES[normalized];
  }

  return rawHandle || sourceKey;
}
