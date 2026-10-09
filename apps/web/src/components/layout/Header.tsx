import { ThemeToggle } from '../ui/ThemeToggle';
import { LanguageToggle } from '../ui/LanguageToggle';
import { Link } from 'react-router-dom';
export const Header = () => (
  <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
    <div className="container flex h-14 items-center justify-between">
      <Link to="/" className="font-bold text-lg">EnergyMonitor</Link>
      <div className="flex items-center space-x-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </div>
  </header>
);