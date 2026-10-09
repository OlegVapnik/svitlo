import { useTranslation } from 'react-i18next';
import { Button } from './Button';
export const LanguageToggle = () => {
  const { i18n } = useTranslation();
  const toggle = () => {
    const next = i18n.language === 'uk' ? 'ru' : 'uk';
    i18n.changeLanguage(next);
    localStorage.setItem('lang', next);
  };
  return <Button variant="ghost" onClick={toggle}>{i18n.language.toUpperCase()}</Button>;
};