/**
 * Офіційна сторінка оператора, де людина може перевірити свою чергу/адресу.
 *
 * Ссылка не подменяет данные: приложение по-прежнему не угадывает номер. Но если источник
 * закрыт (логин/капча), у человека остаётся официальный путь проверки.
 *
 * Джерело правди — реєстр `@svitlo/domain` (`region-sources.ts`): там для кожного регіону
 * зібрана саме БЕЗРАХУНКОВА точка входу (публічний пошук адреси, «Чому немає світла»,
 * пряма таблиця черг), а не головна сторінка сайту. Другий список URL тут не тримаємо:
 * два реєстри неминуче розійшлися б.
 *
 * Для регіонів без підтвердженого сайту ведемо в реєстр НКРЕКП, а не на вигаданий домен.
 */
import { addressBypassOf } from '@svitlo/domain';

/** Псевдо-регіони каталогу (окремі мережі ДТЕК) → cpu області. */
const REGION_ALIASES: Record<string, string> = {
  'dnipro-cek': 'dnipropetrovska-oblast',
  'dnipro-dnem': 'dnipropetrovska-oblast',
};

export interface OperatorLink {
  url: string;
  /** Реестр НКРЕКП — честная подпись, когда сайт оператора не подтверждён. */
  isRegistry: boolean;
  /** Що саме робити на цій сторінці (українською, без емодзі). */
  hintUk: string;
  /** Назва області з реєстру; `null` для реєстру НКРЕКП. */
  nameUa: string | null;
}

const REGISTRY_LINK: OperatorLink = {
  url: 'https://www.nerc.gov.ua/',
  isRegistry: true,
  hintUk: 'Сайт оператора не підтверджено — перелік ліцензіатів НКРЕКП.',
  nameUa: null,
};

export function operatorLink(regionCpu: string | null | undefined): OperatorLink {
  const key = String(regionCpu ?? '').trim();
  const bypass = addressBypassOf(REGION_ALIASES[key] ?? key);
  if (!bypass) return REGISTRY_LINK;
  return {
    url: bypass.url,
    isRegistry: false,
    hintUk: bypass.hintUk,
    nameUa: bypass.nameUa,
  };
}
