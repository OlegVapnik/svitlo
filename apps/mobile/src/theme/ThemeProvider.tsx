import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { vars } from 'nativewind';
import {
  paletteFor,
  themeVars,
  type Palette,
  type ThemeMode,
} from './tokens';

export type { Palette, PowerState, StatusTone, ThemeMode } from './tokens';

interface ThemeContextValue {
  mode: ThemeMode;
  palette: Palette;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Obsidian Dark — единственная тема приложения: ночной режим задаёт и нативная оболочка.
  const mode: ThemeMode = 'dark';
  const value = useMemo<ThemeContextValue>(
    () => ({ mode, palette: paletteFor(mode) }),
    [mode],
  );
  const style = useMemo(() => vars(themeVars(mode)), [mode]);

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
