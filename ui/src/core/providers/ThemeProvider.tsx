import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Theme Provider using next-themes
 *
 * Supports three themes:
 * - light: Light mode (plum accents)
 * - dark: Dark Blue mode (blue tints, hue 250)
 * - midnight: Midnight Black mode (neutral/dark tints)
 *
 * Each theme maps directly to a CSS class on the :root element.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={['light', 'dark', 'midnight']}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
