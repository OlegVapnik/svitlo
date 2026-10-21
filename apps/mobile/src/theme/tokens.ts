/**
 * Токены темы, перенесённые из apps/web/src/styles/globals.css.
 *
 * Система 3 статусов + нейтральный:
 * 1) Світло є (#10B981, смарагдовий) — круг (●)
 * 2) Скоро вимкнення / Скоро увімкнуть (#F59E0B, бурштиновий) — ромб (◆)
 * 3) Відключення (#F43F5E, рубіновий + діагональна штриховка) — квадрат (■)
 * 4) Немає даних (#27272A / #71717A, нейтральний темний) — чесний статус без графіку
 */

export type ThemeMode = 'light' | 'dark';
export type PowerState = 'on' | 'warning' | 'off' | 'allClear' | 'unknown';

export interface StatusTone {
  /** Заливка точки/бейджа/індикатора. */
  color: string;
  /** Текст поверх фону. */
  text: string;
  /** М'яка підложка (бейдж, чіп, світіння). */
  soft: string;
  /** Межа бейджа. */
  border: string;
  /** Геометричний символ форми статусу: ●, ◆, ■ */
  symbol: string;
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
  primary: '#059669',
  onPrimary: '#ffffff',
  primaryContainer: 'rgba(5, 150, 105, 0.12)',
  border: '#e2e8f0',
  borderStrong: '#94a3b8',
  hairline: 'rgba(15, 23, 42, 0.08)',
  track: 'rgba(15, 23, 42, 0.12)',
  success: '#10B981',
  warning: '#F59E0B',
  destructive: '#F43F5E',
  info: '#2563eb',
  unknown: '#71717a',
  levelHigh: '#65a30d',
  status: {
    on: { color: '#10B981', text: '#059669', soft: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)', symbol: '●' },
    allClear: { color: '#10B981', text: '#059669', soft: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)', symbol: '●' },
    warning: { color: '#F59E0B', text: '#d97706', soft: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.35)', symbol: '◆' },
    off: { color: '#F43F5E', text: '#e11d48', soft: 'rgba(244, 63, 94, 0.14)', border: 'rgba(244, 63, 94, 0.35)', symbol: '■' },
    unknown: { color: '#71717a', text: '#52525b', soft: 'rgba(113, 113, 122, 0.12)', border: 'rgba(113, 113, 122, 0.25)', symbol: '●' },
  },
};

export const darkPalette: Palette = {
  surface: '#09090b',
  surfaceDim: '#09090b',
  surfaceContainerLow: '#0e0e12',
  surfaceContainer: '#131318',
  surfaceContainerHigh: '#18181f',
  surfaceContainerHighest: '#24242e',
  card: '#131318',
  cardRaised: '#1b1b22',
  foreground: '#fafafa',
  mutedForeground: '#a1a1aa',
  primary: '#10B981',
  onPrimary: '#09090b',
  primaryContainer: 'rgba(16, 185, 129, 0.14)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: '#3f3f46',
  hairline: 'rgba(255, 255, 255, 0.06)',
  track: 'rgba(255, 255, 255, 0.12)',
  success: '#10B981',
  warning: '#F59E0B',
  destructive: '#F43F5E',
  info: '#3b82f6',
  unknown: '#71717a',
  levelHigh: '#a3e635',
  status: {
    on: { color: '#10B981', text: '#34d399', soft: 'rgba(16, 185, 129, 0.14)', border: 'rgba(16, 185, 129, 0.35)', symbol: '●' },
    allClear: { color: '#10B981', text: '#34d399', soft: 'rgba(16, 185, 129, 0.14)', border: 'rgba(16, 185, 129, 0.35)', symbol: '●' },
    warning: { color: '#F59E0B', text: '#fbbf24', soft: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.4)', symbol: '◆' },
    off: { color: '#F43F5E', text: '#fb7185', soft: 'rgba(244, 63, 94, 0.16)', border: 'rgba(244, 63, 94, 0.4)', symbol: '■' },
    unknown: { color: '#71717a', text: '#a1a1aa', soft: 'rgba(39, 39, 42, 0.6)', border: 'rgba(255, 255, 255, 0.08)', symbol: '●' },
  },
};

export function paletteFor(mode: ThemeMode): Palette {
  return mode === 'dark' ? darkPalette : lightPalette;
}

export function powerTone(mode: ThemeMode, state: PowerState): StatusTone {
  return paletteFor(mode).status[state];
}

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
