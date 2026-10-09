const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\oleg\\.gemini\\antigravity\\scratch\\energy-monitor\\apps\\web';

const files = {
  'package.json': `{
  "name": "@energy-monitor/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@energy-monitor/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.1.0",
    "date-fns-tz": "^3.2.0",
    "echarts": "^5.5.1",
    "echarts-for-react": "^3.0.2",
    "i18next": "^24.2.0",
    "leaflet": "^1.9.4",
    "lucide-react": "^0.468.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-i18next": "^15.4.0",
    "react-leaflet": "^4.2.1",
    "react-router-dom": "^7.1.0",
    "tailwind-merge": "^2.6.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/leaflet": "^1.9.14",
    "@types/react": "^18.3.14",
    "@types/react-dom": "^18.3.3",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.16",
    "typescript": "^5.7.2",
    "vite": "^6.0.0",
    "vite-plugin-pwa": "^0.21.1"
  }
}`,

  'tsconfig.json': `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}`,

  'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'EnergyMonitor — Чернігів',
        short_name: 'EnergyMonitor',
        start_url: '/',
        display: 'standalone',
        theme_color: '#1e40af',
        background_color: '#0f172a',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
});`,

  'tailwind.config.ts': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        status: {
          stable: '#10b981',
          warning: '#f59e0b',
          emergency: '#ef4444'
        }
      }
    },
    container: {
      center: true,
      padding: '1rem',
    }
  },
  plugins: [],
};`,

  'postcss.config.js': `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`,

  'index.html': `<!DOCTYPE html>
<html lang="uk">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#1e40af" />
    <link rel="manifest" href="/manifest.json" />
    <title>EnergyMonitor — Чернігів</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,

  'public/manifest.json': `{
  "name": "EnergyMonitor — Чернігів",
  "short_name": "EnergyMonitor",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#1e40af",
  "background_color": "#0f172a",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}`,

  'src/styles/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --primary: 221.2 83.2% 53.3%;
    --muted: 210 40% 96.1%;
    --border: 214.3 31.8% 91.4%;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --primary: 217.2 91.2% 59.8%;
    --muted: 217.2 32.6% 17.5%;
    --border: 217.2 32.6% 17.5%;
  }

  html {
    scroll-behavior: smooth;
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  body {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
}`,

  'src/lib/cn.ts': `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}`,

  'src/lib/date.ts': `import { format, formatDistanceToNow, isToday as checkIsToday, isTomorrow as checkIsTomorrow } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { uk } from 'date-fns/locale';

export const KYIV_TZ = 'Europe/Kyiv';

export function formatDateTime(iso: string): string {
  return formatInTimeZone(new Date(iso), KYIV_TZ, "d MMM yyyy, HH:mm", { locale: uk });
}

export function formatTimeRange(start: string, end: string): string {
  const t1 = formatInTimeZone(new Date(start), KYIV_TZ, 'HH:mm');
  const t2 = formatInTimeZone(new Date(end), KYIV_TZ, 'HH:mm');
  return \`\${t1} – \${t2}\`;
}

export function formatRelative(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: uk });
}

export function isActive(start: string, end: string): boolean {
  const now = new Date();
  return new Date(start) <= now && new Date(end) >= now;
}

export function isToday(iso: string): boolean {
  return checkIsToday(new Date(iso));
}

export function isTomorrow(iso: string): boolean {
  return checkIsTomorrow(new Date(iso));
}`,

  'src/i18n/config.ts': `import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uk from './uk.json';
import ru from './ru.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      uk: { translation: uk },
      ru: { translation: ru },
    },
    lng: localStorage.getItem('lang') || 'uk',
    fallbackLng: 'uk',
    interpolation: { escapeValue: false }
  });

export default i18n;`,

  'src/i18n/uk.json': `{
  "nav": { "home": "Головна", "outages": "Відключення", "incidents": "Аварії", "contacts": "Контакти", "myAddress": "Моя адреса" },
  "status": { "stable": "Стабільно", "warning": "Можливі збої", "emergency": "Аварійна ситуація", "lastUpdated": "Оновлено", "dataStale": "Застарілі дані", "minutesAgo": "хвилин тому" },
  "outages": { "title": "Відключення", "planned": "Планові", "active": "Активні", "finished": "Завершені", "cancelled": "Скасовані", "scheduled": "Заплановані", "noOutages": "Відключень не знайдено", "search": "Пошук", "filterDate": "Фільтр за датою", "today": "Сьогодні", "tomorrow": "Завтра", "thisWeek": "Цей тиждень", "customRange": "Власний діапазон", "allStatuses": "Всі статуси", "queue": "Черга", "area": "Район", "list": "Список", "calendar": "Календар", "chart": "Графік", "map": "Карта", "from": "Від", "to": "До", "reason": "Причина", "addresses": "Адреси", "affectedArea": "Зона відключення" },
  "incidents": { "title": "Аварії", "active": "Активні", "resolved": "Вирішені", "eta": "Орієнтовний час", "severity": "Серйозність", "noIncidents": "Немає активних аварій" },
  "contacts": { "title": "Контакти", "callCenter": "Кол-центр", "telegram": "Telegram", "viber": "Viber", "facebook": "Facebook", "onlineForm": "Онлайн форма" },
  "myAddress": { "title": "Моя адреса", "placeholder": "Введіть адресу", "save": "Зберегти", "clear": "Очистити", "description": "Збережіть адресу для швидкого доступу", "noResults": "Нічого не знайдено" },
  "common": { "loading": "Завантаження...", "error": "Помилка", "retry": "Спробувати ще раз", "updatedAt": "Оновлено о", "showMore": "Показати більше", "noData": "Немає даних" },
  "charts": { "byHour": "За годинами", "byDay": "За днями", "byArea": "За районами", "heatmap": "Теплова карта", "timeline": "Таймлайн", "outageCount": "Кількість відключень", "durationMinutes": "Тривалість (хв)" }
}`,

  'src/i18n/ru.json': `{
  "nav": { "home": "Главная", "outages": "Отключения", "incidents": "Аварии", "contacts": "Контакты", "myAddress": "Мой адрес" },
  "status": { "stable": "Стабильно", "warning": "Возможны сбои", "emergency": "Аварийная ситуация", "lastUpdated": "Обновлено", "dataStale": "Устаревшие данные", "minutesAgo": "минут назад" },
  "outages": { "title": "Отключения", "planned": "Плановые", "active": "Активные", "finished": "Завершенные", "cancelled": "Отмененные", "scheduled": "Запланированные", "noOutages": "Отключений не найдено", "search": "Поиск", "filterDate": "Фильтр по дате", "today": "Сегодня", "tomorrow": "Завтра", "thisWeek": "Эта неделя", "customRange": "Свой диапазон", "allStatuses": "Все статусы", "queue": "Очередь", "area": "Район", "list": "Список", "calendar": "Календарь", "chart": "График", "map": "Карта", "from": "От", "to": "До", "reason": "Причина", "addresses": "Адреса", "affectedArea": "Зона отключения" },
  "incidents": { "title": "Аварии", "active": "Активные", "resolved": "Решенные", "eta": "Ориентировочное время", "severity": "Серьезность", "noIncidents": "Нет активных аварий" },
  "contacts": { "title": "Контакты", "callCenter": "Колл-центр", "telegram": "Telegram", "viber": "Viber", "facebook": "Facebook", "onlineForm": "Онлайн форма" },
  "myAddress": { "title": "Мой адрес", "placeholder": "Введите адрес", "save": "Сохранить", "clear": "Очистить", "description": "Сохраните адрес для быстрого доступа", "noResults": "Ничего не найдено" },
  "common": { "loading": "Загрузка...", "error": "Ошибка", "retry": "Повторить", "updatedAt": "Обновлено в", "showMore": "Показать больше", "noData": "Нет данных" },
  "charts": { "byHour": "По часам", "byDay": "По дням", "byArea": "По районам", "heatmap": "Тепловая карта", "timeline": "Таймлайн", "outageCount": "Количество отключений", "durationMinutes": "Длительность (мин)" }
}`,

  'src/api/client.ts': `const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

async function fetcher(endpoint: string, options?: RequestInit) {
  const res = await fetch(\`\${API_BASE}\${endpoint}\`, options);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export const api = {
  fetchOutages: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params) : '';
    return fetcher(\`/outages\${q}\`);
  },
  fetchOutage: (id: string) => fetcher(\`/outages/\${id}\`),
  fetchOutageStats: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params) : '';
    return fetcher(\`/outages/stats\${q}\`);
  },
  fetchIncidents: () => fetcher('/incidents'),
  fetchStatus: () => fetcher('/status'),
  fetchContacts: () => fetcher('/contacts'),
  fetchHealth: () => fetcher('/health')
};`,

  'src/api/queries.ts': `import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export const useOutages = (filters?: Record<string, string>) => useQuery({
  queryKey: ['outages', filters],
  queryFn: () => api.fetchOutages(filters),
});

export const useOutage = (id: string) => useQuery({
  queryKey: ['outage', id],
  queryFn: () => api.fetchOutage(id),
  enabled: !!id,
});

export const useOutageStats = (params?: Record<string, string>) => useQuery({
  queryKey: ['outagesStats', params],
  queryFn: () => api.fetchOutageStats(params),
});

export const useIncidents = () => useQuery({
  queryKey: ['incidents'],
  queryFn: api.fetchIncidents,
  refetchInterval: 60000,
});

export const useStatus = () => useQuery({
  queryKey: ['status'],
  queryFn: api.fetchStatus,
  refetchInterval: 30000,
});

export const useContacts = () => useQuery({
  queryKey: ['contacts'],
  queryFn: api.fetchContacts,
});

export const useHealth = () => useQuery({
  queryKey: ['health'],
  queryFn: api.fetchHealth,
});`,

  'src/hooks/useTheme.ts': `import { useState, useEffect } from 'react';

export function useTheme() {
  const [theme, setThemeState] = useState(localStorage.getItem('theme') || 'light');

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const setTheme = (t: string) => setThemeState(t);
  const toggleTheme = () => setThemeState(prev => prev === 'dark' ? 'light' : 'dark');

  return { theme, setTheme, toggleTheme };
}`,

  'src/hooks/useMyAddress.ts': `import { useState } from 'react';

export function useMyAddress() {
  const [address, setAddressState] = useState(localStorage.getItem('myAddress') || '');

  const setAddress = (a: string) => {
    setAddressState(a);
    localStorage.setItem('myAddress', a);
  };
  const clearAddress = () => {
    setAddressState('');
    localStorage.removeItem('myAddress');
  };

  return { address, setAddress, clearAddress };
}`,

  'src/hooks/useMediaQuery.ts': `import { useState, useEffect } from 'react';

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
export const useIsTablet = () => useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');`,

  'src/components/ui/Button.tsx': `import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 min-h-[44px]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline: 'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-11 rounded-md px-3 text-xs',
        lg: 'h-12 rounded-md px-8',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';`,

  'src/components/ui/Card.tsx': `import * as React from 'react';
import { cn } from '@/lib/cn';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('rounded-xl border bg-card text-card-foreground shadow', className)} {...props} />
));

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
));

export const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
));

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
));`,

  'src/components/ui/Badge.tsx': `import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-status-emergency text-white shadow hover:bg-status-emergency/80',
        warning: 'border-transparent bg-status-warning text-white shadow hover:bg-status-warning/80',
        success: 'border-transparent bg-status-stable text-white shadow hover:bg-status-stable/80',
        outline: 'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}`,

  'src/components/ui/Input.tsx': `import * as React from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn('flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', className)}
      ref={ref}
      {...props}
    />
  );
});`,

  'src/components/ui/Skeleton.tsx': `import * as React from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}`,

  'src/components/ui/Tabs.tsx': `import * as React from 'react';

// Simplified Tabs implementation for brevity
export const Tabs = ({ children, defaultValue, className }: any) => {
  const [active, setActive] = React.useState(defaultValue);
  return (
    <div className={className}>
      {React.Children.map(children, child => 
        React.cloneElement(child, { active, setActive })
      )}
    </div>
  );
};

export const TabsList = ({ children, active, setActive, className }: any) => (
  <div className={className || 'flex space-x-2 border-b mb-4'}>
    {React.Children.map(children, child => 
      React.cloneElement(child, { active, setActive })
    )}
  </div>
);

export const TabsTrigger = ({ children, value, active, setActive, className }: any) => (
  <button
    className={\`px-4 py-2 \${active === value ? 'border-b-2 border-primary font-bold' : ''} \${className || ''}\`}
    onClick={() => setActive(value)}
  >
    {children}
  </button>
);

export const TabsContent = ({ children, value, active, className }: any) => {
  if (value !== active) return null;
  return <div className={className}>{children}</div>;
};`,

  'src/components/ui/Select.tsx': `export const Select = (props: any) => <select className="border p-2 rounded" {...props} />;`,
  'src/components/ui/Dialog.tsx': `export const Dialog = () => null; // Placeholder`,
  'src/components/ui/ThemeToggle.tsx': `import { useTheme } from '@/hooks/useTheme';
import { Button } from './Button';
import { Moon, Sun } from 'lucide-react';
export const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  return <Button variant="ghost" size="icon" onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>;
};`,
  'src/components/ui/LanguageToggle.tsx': `import { useTranslation } from 'react-i18next';
import { Button } from './Button';
export const LanguageToggle = () => {
  const { i18n } = useTranslation();
  const toggle = () => {
    const next = i18n.language === 'uk' ? 'ru' : 'uk';
    i18n.changeLanguage(next);
    localStorage.setItem('lang', next);
  };
  return <Button variant="ghost" onClick={toggle}>{i18n.language.toUpperCase()}</Button>;
};`,

  'src/components/common/ErrorBoundary.tsx': `import React from 'react';
export class ErrorBoundary extends React.Component<any, { hasError: boolean }> {
  constructor(props: any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <div><h1>Something went wrong.</h1><button onClick={() => window.location.reload()}>Retry</button></div>;
    return this.props.children;
  }
}`,
  'src/components/common/EmptyState.tsx': `export const EmptyState = ({ title, description }: any) => <div className="text-center p-8"><h3 className="font-bold">{title}</h3><p>{description}</p></div>;`,
  'src/components/common/ErrorState.tsx': `export const ErrorState = ({ onRetry }: any) => <div className="text-center text-red-500 p-8"><p>Error</p><button onClick={onRetry}>Retry</button></div>;`,

  'src/components/layout/Header.tsx': `import { ThemeToggle } from '../ui/ThemeToggle';
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
);`,
  
  'src/components/layout/BottomNav.tsx': `import { Home, Zap, AlertTriangle, Phone, MapPin } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export const BottomNav = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const items = [
    { to: '/', icon: Home, label: t('nav.home') },
    { to: '/outages', icon: Zap, label: t('nav.outages') },
    { to: '/incidents', icon: AlertTriangle, label: t('nav.incidents') },
    { to: '/contacts', icon: Phone, label: t('nav.contacts') },
    { to: '/my-address', icon: MapPin, label: t('nav.myAddress') }
  ];

  return (
    <nav className="fixed bottom-0 w-full border-t bg-background pb-safe flex justify-around p-2 md:hidden">
      {items.map(item => {
        const active = pathname === item.to;
        return (
          <Link key={item.to} to={item.to} className={cn("flex flex-col items-center p-2", active ? "text-primary" : "text-muted-foreground")}>
            <item.icon className="h-6 w-6" />
            <span className="text-[10px] mt-1">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  );
};`,

  'src/components/layout/Sidebar.tsx': `import { Home, Zap, AlertTriangle, Phone, MapPin } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export const Sidebar = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const items = [
    { to: '/', icon: Home, label: t('nav.home') },
    { to: '/outages', icon: Zap, label: t('nav.outages') },
    { to: '/incidents', icon: AlertTriangle, label: t('nav.incidents') },
    { to: '/contacts', icon: Phone, label: t('nav.contacts') },
    { to: '/my-address', icon: MapPin, label: t('nav.myAddress') }
  ];

  return (
    <nav className="hidden md:flex flex-col w-64 border-r p-4 space-y-2 h-[calc(100vh-3.5rem)]">
      {items.map(item => {
        const active = pathname === item.to;
        return (
          <Link key={item.to} to={item.to} className={cn("flex items-center space-x-3 p-3 rounded-lg hover:bg-accent", active ? "bg-accent text-primary font-medium" : "text-muted-foreground")}>
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  );
};`,

  'src/components/layout/AppShell.tsx': `import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { Outlet } from 'react-router-dom';
export const AppShell = () => (
  <div className="min-h-screen bg-background flex flex-col">
    <Header />
    <div className="flex flex-1 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4 md:p-8 pb-24 md:pb-8">
        <Outlet />
      </main>
    </div>
    <BottomNav />
  </div>
);`,

  'src/components/status/StatusIndicator.tsx': `import { useStatus } from '@/api/queries';
import { useTranslation } from 'react-i18next';
export const StatusIndicator = () => {
  const { data } = useStatus();
  const { t } = useTranslation();
  if (!data) return null;
  return <div className="p-6 bg-status-stable/10 text-status-stable rounded-xl flex items-center space-x-4"><div className="w-4 h-4 bg-status-stable rounded-full animate-pulse" /> <span className="text-2xl font-bold">{t('status.stable')}</span></div>;
};`,

  'src/components/status/LastUpdated.tsx': `export const LastUpdated = () => <div className="text-sm text-muted-foreground">Оновлено щойно</div>;`,
  'src/components/incidents/IncidentBanner.tsx': `export const IncidentBanner = () => null;`,
  'src/components/incidents/IncidentList.tsx': `export const IncidentList = () => <div>Incidents</div>;`,
  'src/components/outages/OutageCard.tsx': `export const OutageCard = () => <div>Card</div>;`,
  'src/components/outages/OutageList.tsx': `export const OutageList = () => <div>List</div>;`,
  'src/components/outages/OutageCalendar.tsx': `export const OutageCalendar = () => <div>Calendar</div>;`,
  'src/components/outages/OutageTimeline.tsx': `export const OutageTimeline = () => <div>Timeline</div>;`,
  'src/components/outages/OutageHeatmap.tsx': `export const OutageHeatmap = () => <div>Heatmap</div>;`,
  'src/components/outages/OutageBarChart.tsx': `export const OutageBarChart = () => <div>BarChart</div>;`,
  'src/components/outages/OutageMap.tsx': `export const OutageMap = () => <div>Map</div>;`,
  'src/components/search/SearchBar.tsx': `export const SearchBar = () => <input type="text" placeholder="Search..." className="border p-2 w-full rounded" />;`,
  'src/components/search/FilterPanel.tsx': `export const FilterPanel = () => <div>Filters</div>;`,

  'src/pages/HomePage.tsx': `import { StatusIndicator } from '@/components/status/StatusIndicator';
export const HomePage = () => <div><StatusIndicator /></div>;`,
  'src/pages/OutagesPage.tsx': `export const OutagesPage = () => <div>Outages</div>;`,
  'src/pages/IncidentsPage.tsx': `export const IncidentsPage = () => <div>Incidents</div>;`,
  'src/pages/ContactsPage.tsx': `export const ContactsPage = () => <div>Contacts</div>;`,
  'src/pages/MyAddressPage.tsx': `export const MyAddressPage = () => <div>My Address</div>;`,

  'src/router.tsx': `import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './pages/HomePage';
import { OutagesPage } from './pages/OutagesPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { ContactsPage } from './pages/ContactsPage';
import { MyAddressPage } from './pages/MyAddressPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'outages', element: <OutagesPage /> },
      { path: 'incidents', element: <IncidentsPage /> },
      { path: 'contacts', element: <ContactsPage /> },
      { path: 'my-address', element: <MyAddressPage /> },
    ]
  }
]);`,

  'src/App.tsx': `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { router } from './router';
import './i18n/config';

const queryClient = new QueryClient();

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}`,

  'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);`
};

for (const [relPath, content] of Object.entries(files)) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}
console.log('Done');
