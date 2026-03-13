/**
 * Auth Guard Component
 *
 * Protects routes by requiring authentication.
 * Redirects to OOBE wizard if first-time setup is needed,
 * or to login if in multi-user mode and not authenticated.
 */

import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

interface OOBEStatus {
  needsSetup: boolean;
  authMode: string;
}

function useOOBEStatus() {
  return useQuery({
    queryKey: ['oobe', 'status'],
    queryFn: async (): Promise<OOBEStatus> => {
      const res = await fetch('/api/oobe/status');
      if (!res.ok) return { needsSetup: true, authMode: 'local' };
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}

interface AuthGuardProps {
  children: ReactNode;
  /**
   * If true, requires user to have completed onboarding
   */
  requireOnboarding?: boolean;
}

export function AuthGuard({ children, requireOnboarding = false }: AuthGuardProps) {
  const { isAuthenticated, isLoading, user, authMode, accessKeyRequired } = useAuth();
  const { data: oobeStatus, isLoading: oobeLoading } = useOOBEStatus();
  const location = useLocation();

  // Show loading state while checking auth + oobe
  if (isLoading || oobeLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
          <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to OOBE wizard if first-time setup needed
  if (oobeStatus?.needsSetup) {
    return <Navigate to="/oobe" replace />;
  }

  // Local mode with access key: redirect to access key page
  if (!isAuthenticated && authMode === 'local' && accessKeyRequired) {
    return <Navigate to="/access-key" state={{ from: location }} replace />;
  }

  // Local mode without access key: user is auto-authenticated by middleware
  // (isAuthenticated should already be true, but guard against edge cases)
  if (!isAuthenticated && authMode === 'local' && !accessKeyRequired) {
    // Auto-auth should have handled this; render children optimistically
    return <>{children}</>;
  }

  // Multi mode: redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Redirect to onboarding if required but not completed
  if (requireOnboarding && user && !user.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

/**
 * Guest Guard Component
 *
 * For pages that should only be accessible when NOT logged in (login, signup).
 * Redirects to onboarding or dashboard based on completion status.
 * Also redirects to OOBE if setup is needed.
 */
export function GuestGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user, authMode, accessKeyRequired } = useAuth();
  const { data: oobeStatus, isLoading: oobeLoading } = useOOBEStatus();
  const location = useLocation();

  // Show loading state while checking auth + oobe
  if (isLoading || oobeLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
          <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to OOBE if setup is needed
  if (oobeStatus?.needsSetup) {
    return <Navigate to="/oobe" replace />;
  }

  // Local mode without access key: never show login/guest pages
  if (authMode === 'local' && !accessKeyRequired) {
    return <Navigate to="/" replace />;
  }

  // Redirect based on onboarding status if authenticated
  if (isAuthenticated) {
    // If user hasn't completed onboarding, send to onboarding
    if (user && !user.onboardingCompleted) {
      return <Navigate to="/onboarding" replace />;
    }
    // Otherwise, go to intended destination or dashboard
    const from = (location.state as { from?: Location })?.from?.pathname || '/';
    return <Navigate to={from} replace />;
  }

  return <>{children}</>;
}
