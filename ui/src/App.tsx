import { Providers } from '@/core/providers';
import { AppRouter } from '@/router';
import { ToastProvider } from '@/components/shared/Toaster';
import { OnboardingTour } from '@/components/shared/OnboardingTour';
import { KeyboardShortcuts } from '@/components/shared/KeyboardShortcuts';
import './index.css';

function App() {
  return (
    <Providers>
      <AppRouter />
      <ToastProvider />
      <OnboardingTour />
      <KeyboardShortcuts />
    </Providers>
  );
}

export default App;
