import type { ReactNode } from 'react';
import { ThemeProvider } from './ThemeProvider';
import { QueryProvider } from './QueryProvider';
import { EventStreamProvider } from './EventStreamProvider';
import { AuthProvider } from '@/features/auth';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <QueryProvider>
      <AuthProvider>
        <ThemeProvider>
          <EventStreamProvider>
            {children}
          </EventStreamProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryProvider>
  );
}

export { ThemeProvider } from './ThemeProvider';
export { QueryProvider } from './QueryProvider';
export { EventStreamProvider } from './EventStreamProvider';
