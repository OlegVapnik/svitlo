import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uk from './uk.json';
import ru from './ru.json';
import en from './en.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      uk: { translation: uk },
      ru: { translation: ru },
      en: { translation: en },
    },
    lng: localStorage.getItem('lang') || 'uk',
    fallbackLng: 'uk',
    interpolation: { escapeValue: false }
  });

export default i18n;