/**
 * Токены темы, перенесённые из apps/web/src/styles/globals.css.
 *
 * Здесь только значения. Классы Tailwind (bg-surface, text-foreground, …) статичны и читают
 * CSS-переменные, которые ThemeProvider выставляет через NativeWind `vars()`. Динамические
 * цвета (состояние сети, ячейки графиков) берём из `powerTone()` и передаём в `style`, а не
 * собираем className на лету — инжектор NativeWind компилирует классы статически.
 */

export type ThemeMode = 'light' | 'dark';
export type PowerState = 'on' | 'warning' | 'off' | 'unknown';

export interface StatusTone {
  /** Заливка точки/бейджа. */
  color: string;
  /** Текст поверх фона. */
  text: string;
  /** Мягкая подложка (бейдж, чип, свечение). */
  soft: string;
  /** Граница бейджа. */
  border: string;
}

export interface Palette {
  surface: string;
  surfaceDim: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  card: string;
  cardRaised: string;
  foreground: string;
  mutedForeground: string;
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  border: string;
  borderStrong: string;
  hairline: string;
  track: string;
  success: string;
  warning: string;
  destructive: string;
  info: string;
  unknown: string;
  levelHigh: string;
  status: Record<PowerState, StatusTone>;
}

export const lightPalette: Palette = {
  surface: '#f8fafc',
  surfaceDim: '#f1f5f9',
  surfaceContainerLow: '#ffffff',
  surfaceContainer: '#ffffff',
  surfaceContainerHigh: '#f1f5f9',
  surfaceContainerHighest: '#e2e8f0',
  card: '#ffffff',
  cardRaised: '#f1f5f9',
  foreground: '#0f172a',
  mutedForeground: '#64748b',
  primary: '#047857',
  onPrimary: '#ffffff',
  primaryContainer: 'rgba(4, 120, 87, 0.12)',
  border: '#e2e8f0',
  borderStrong: '#94a3b8',
  hairline: 'rgba(15, 23, 42, 0.08)',
  track: 'rgba(15, 23, 42, 0.12)',
  success: '#059669',
  warning: '#d97706',
  destructive: '#e11d48',
  info: '#2563eb',
  unknown: '#71717a',
  levelHigh: '#65a30d',
  status: {
    on: { color: '#059669', text: '#047857', soft: 'rgba(5, 150, 105, 0.10)', border: 'rgba(5, 150, 105, 0.25)' },
    warning: { color: '#d97706', text: '#b45309', soft: 'rgba(217, 119, 6, 0.10)', border: 'rgba(217, 119, 6, 0.25)' },
    off: { color: '#e11d48', text: '#be123c', soft: 'rgba(225, 29, 72, 0.10)', border: 'rgba(225, 29, 72, 0.25)' },
    unknown: { color: '#71717a', text: '#52525b', soft: 'rgba(113, 113, 122, 0.10)', border: 'rgba(113, 113, 122, 0.25)' },
  },
};

export const darkPalette: Palette = {
  surface: '#09090b',
  surfaceDim: '#09090b',
  surfaceContainerLow: '#0e0e12',
  surfaceContainer: '#131318',
  surfaceContainerHigh: '#1b1b22',
  surfaceContainerHighest: '#23232c',
  card: '#131318',
  cardRaised: '#1b1b22',
  foreground: '#fafafa',
  mutedForeground: '#a1a1aa',
  primary: '#10b981',
  onPrimary: '#09090b',
  primaryContainer: 'rgba(16, 185, 129, 0.14)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: '#3f3f46',
  hairline: 'rgba(255, 255, 255, 0.06)',
  track: 'rgba(255, 255, 255, 0.12)',
  success: '#10b981',
  warning: '#f59e0b',
  destructive: '#f43f5e',
  info: '#3b82f6',
  unknown: '#71717a',
  levelHigh: '#a3e635',
  status: {
    on: { color: '#10b981', text: '#34d399', soft: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.25)' },
    warning: { color: '#f59e0b', text: '#fbbf24', soft: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.25)' },
    off: { color: '#f43f5e', text: '#fb7185', soft: 'rgba(244, 63, 94, 0.12)', border: 'rgba(244, 63, 94, 0.25)' },
    unknown: { color: '#71717a', text: '#a1a1aa', soft: 'rgba(113, 113, 122, 0.12)', border: 'rgba(113, 113, 122, 0.25)' },
  },
};

export function paletteFor(mode: ThemeMode): Palette {
  return mode === 'dark' ? darkPalette : lightPalette;
}

/** Цвета для конкретного состояния сети — для `style`, графиков и свечения. */
export function powerTone(mode: ThemeMode, state: PowerState): StatusTone {
  return paletteFor(mode).status[state];
}

/** CSS-переменные для NativeWind `vars()`: статичные классы Tailwind читают их. */
export function themeVars(mode: ThemeMode, powerState: PowerState = 'unknown'): Record<string, string> {
  const p = paletteFor(mode);
  const tone = p.status[powerState];
  return {
    '--color-surface': p.surface,
    '--color-surface-dim': p.surfaceDim,
    '--color-surface-container-low': p.surfaceContainerLow,
    '--color-surface-container': p.surfaceContainer,
    '--color-surface-container-high': p.surfaceContainerHigh,
    '--color-surface-container-highest': p.surfaceContainerHighest,
    '--color-card': p.card,
    '--color-card-raised': p.cardRaised,
    '--color-foreground': p.foreground,
    '--color-muted-foreground': p.mutedForeground,
    '--color-primary': p.primary,
    '--color-on-primary': p.onPrimary,
    '--color-primary-container': p.primaryContainer,
    '--color-border': p.border,
    '--color-border-strong': p.borderStrong,
    '--color-hairline': p.hairline,
    '--color-track': p.track,
    '--color-success': p.success,
    '--color-warning': p.warning,
    '--color-destructive': p.destructive,
    '--color-info': p.info,
    '--color-unknown': p.unknown,
    '--color-level-high': p.levelHigh,
    '--color-status': tone.color,
    '--color-status-text': tone.text,
    '--color-status-soft': tone.soft,
    '--color-status-border': tone.border,
  };
}
