import { useTranslation } from 'react-i18next';
import { Button } from './Button';

const LANG_CYCLE: Record<string, string> = {
  uk: 'en',
  en: 'ru',
  ru: 'uk',
};

export const LanguageToggle = () => {
  const { i18n } = useTranslation();
  const toggle = () => {
    const current = i18n.language.startsWith('en')
      ? 'en'
      : i18n.language.startsWith('ru')
        ? 'ru'
        : 'uk';
    const next = LANG_CYCLE[current] ?? 'uk';
    i18n.changeLanguage(next);
    localStorage.setItem('lang', next);
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={`Change language: current ${i18n.language.toUpperCase()}`}
      className="min-h-[44px] min-w-[44px] px-2 font-mono font-bold"
    >
      {i18n.language.slice(0, 2).toUpperCase()}
    </Button>
  );
};