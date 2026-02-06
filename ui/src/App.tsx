import { Providers } from '@/core/providers';
import { AppRouter } from '@/router';
import { ToastProvider } from '@/components/shared/Toaster';
import { OnboardingTour } from '@/components/shared/OnboardingTour';
import { KeyboardShortcuts } from '@/components/shared/KeyboardShortcuts';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import './index.css';

function App() {
  return (
    <ErrorBoundary>
      <Providers>
        <AppRouter />
        <ToastProvider />
        <OnboardingTour />
        <KeyboardShortcuts />
      </Providers>
    </ErrorBoundary>
  );
}

export default App;
