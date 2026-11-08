/**
 * Токены перенесены из apps/web/src/styles/globals.css (@theme inline).
 *
 * Цвета — ссылки на CSS-переменные NativeWind: значения подставляет ThemeProvider
 * (src/theme), поэтому светлая/тёмная тема и состояния сети переключаются в JS без
 * пересборки классов. Статичные утилиты (отступы, радиусы, типографика) — обычный Tailwind.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: 'var(--color-surface)',
        'surface-dim': 'var(--color-surface-dim)',
        'surface-container-low': 'var(--color-surface-container-low)',
        'surface-container': 'var(--color-surface-container)',
        'surface-container-high': 'var(--color-surface-container-high)',
        'surface-container-highest': 'var(--color-surface-container-highest)',
        card: 'var(--color-card)',
        'card-raised': 'var(--color-card-raised)',
        foreground: 'var(--color-foreground)',
        'muted-foreground': 'var(--color-muted-foreground)',
        primary: 'var(--color-primary)',
        'on-primary': 'var(--color-on-primary)',
        'primary-container': 'var(--color-primary-container)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        hairline: 'var(--color-hairline)',
        track: 'var(--color-track)',
        status: 'var(--color-status)',
        'status-text': 'var(--color-status-text)',
        'status-soft': 'var(--color-status-soft)',
        'status-border': 'var(--color-status-border)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        destructive: 'var(--color-destructive)',
        info: 'var(--color-info)',
        unknown: 'var(--color-unknown)',
        'level-high': 'var(--color-level-high)',
      },
      borderRadius: {
        card: '1rem',
      },
    },
  },
};
