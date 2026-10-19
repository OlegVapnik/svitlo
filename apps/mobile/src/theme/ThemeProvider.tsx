import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useColorScheme } from 'react-native';
import { vars } from 'nativewind';
import {
  paletteFor,
  themeVars,
  type Palette,
  type PowerState,
  type ThemeMode,
} from './tokens';

export type { Palette, PowerState, StatusTone, ThemeMode } from './tokens';

interface ThemeContextValue {
  mode: ThemeMode;
  palette: Palette;
  /** Состояние сети для статусных токенов (фаза 2 заменит на usePowerState). */
  powerState: PowerState;
  setPowerState: (state: PowerState) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const mode: ThemeMode = scheme === 'dark' ? 'dark' : 'light';
  const [powerState, setPowerState] = useState<PowerState>('unknown');

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, palette: paletteFor(mode), powerState, setPowerState }),
    [mode, powerState],
  );
  const style = useMemo(() => vars(themeVars(mode, powerState)), [mode, powerState]);

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
