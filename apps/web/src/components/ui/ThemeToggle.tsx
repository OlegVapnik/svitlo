import { useTheme } from '@/hooks/useTheme';
import { Button } from './Button';
import { Moon, Sun } from 'lucide-react';
export const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  return <Button variant="ghost" size="icon" onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>;
};