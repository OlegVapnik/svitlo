import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uk from './uk.json';

/**
 * Мова одна — українська. Раніше був циклічний перемикач uk → en → ru і `localStorage.lang`;
 * він давав три різні тексти для одного й того самого факту (і три різні кількості потоку
 * перекладів, які розходились). Тут навмисно НЕ читаємо `localStorage`: старий ключ у браузера
 * користувача не має «вмикати» мову, якої більше немає в бандлі.
 */
i18n
  .use(initReactI18next)
  .init({
    resources: {
      uk: { translation: uk },
    },
    lng: 'uk',
    fallbackLng: 'uk',
    supportedLngs: ['uk'],
    interpolation: { escapeValue: false },
  });

export default i18n;
