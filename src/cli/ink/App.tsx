/**
 * Ink App Wrapper
 *
 * Root container for all Ink-based TUI screens. Provides consistent
 * padding and flex column layout.
 */

import React from 'react';
import { Box } from 'ink';

interface AppProps {
  children: React.ReactNode;
}

export const App: React.FC<AppProps> = ({ children }) => {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {children}
    </Box>
  );
};
