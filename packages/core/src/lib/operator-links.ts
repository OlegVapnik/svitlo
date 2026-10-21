/**
 * Официальные страницы операторов, где человек может посмотреть свою группу/чергу.
 *
 * Ссылка не подменяет данные: приложение по-прежнему не угадывает номер. Но если источник
 * закрыт (логин/капча), у человека остаётся официальный путь проверки. Для областей без
 * подтверждённого адреса сайта ведём в реестр НКРЕКП, а не на выдуманный домен.
 */
const OPERATOR_URLS: Record<string, string> = {
  'kyiv-city': 'https://www.dtek-kem.com.ua/ua/shutdowns',
  'kyivska-oblast': 'https://www.dtek-kem.com.ua/ua/shutdowns',
  'dnipropetrovska-oblast': 'https://www.dtek-dnem.com.ua/ua/shutdowns',
  'dnipro-cek': 'https://www.dtek-dnem.com.ua/ua/shutdowns',
  'dnipro-dnem': 'https://www.dtek-dnem.com.ua/ua/shutdowns',
  'odeska-oblast': 'https://www.dtek-oem.com.ua/ua/shutdowns',
  'donetska-oblast': 'https://www.dtek-dem.com.ua/ua/shutdowns',
  'vinnytska-oblast': 'https://www.voe.com.ua/',
  'zhytomyrska-oblast': 'https://www.ztoe.com.ua/',
  'zaporizka-oblast': 'https://www.zoe.com.ua/',
  'kirovohradska-oblast': 'https://www.kiroe.com.ua/',
  'lvivska-oblast': 'https://www.loe.lviv.ua/',
  'poltavska-oblast': 'https://www.poe.pl.ua/',
  'sumska-oblast': 'https://www.soe.com.ua/',
  'ternopilska-oblast': 'https://www.toe.com.ua/',
  'kharkivska-oblast': 'https://www.oblenergo.kharkov.ua/',
  'khersonska-oblast': 'https://www.ksoe.com.ua/',
  'khmelnytska-oblast': 'https://www.hoe.com.ua/',
  'cherkaska-oblast': 'https://www.cherkasyoblenergo.com/',
  'chernihivska-oblast': 'https://chernihivoblenergo.com.ua/power_outages',
};

export interface OperatorLink {
  url: string;
  /** Реестр НКРЕКП — честная подпись, когда сайт оператора не подтверждён. */
  isRegistry: boolean;
}

export function operatorLink(regionCpu: string | null | undefined): OperatorLink {
  const key = String(regionCpu ?? '').trim();
  const known = OPERATOR_URLS[key];
  return known
    ? { url: known, isRegistry: false }
    : { url: 'https://www.nerc.gov.ua/', isRegistry: true };
}
