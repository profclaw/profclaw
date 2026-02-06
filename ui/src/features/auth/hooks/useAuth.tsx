/**
 * Auth Context & Hook
 *
 * Provides authentication state throughout the app.
 */

import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  role: string;
  status: string;
  onboardingCompleted: boolean;
  hasGitHubToken?: boolean;
  connectedAccounts?: Array<{
    provider: string;
    username: string;
  }>;
}

// ============================================================================
// Last User Persistence
// ============================================================================

const LAST_USER_KEY = 'glinr_last_user';

export interface LastUser {
  email: string;
  name: string;
  avatarUrl?: string | null;
}

/**
 * Save last logged-in user to localStorage
 */
export function saveLastUser(user: User): void {
  try {
    const lastUser: LastUser = {
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(lastUser));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get last logged-in user from localStorage
 */
export function getLastUser(): LastUser | null {
  try {
    const stored = localStorage.getItem(LAST_USER_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as LastUser;
  } catch {
    return null;
  }
}

/**
 * Clear last user from localStorage
 */
export function clearLastUser(): void {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Ignore storage errors
  }
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  loginWithGitHub: () => void;
  logout: () => Promise<void>;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Fetch current user
  const {
    data: authData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 401) return { authenticated: false };
        throw new Error('Failed to fetch auth status');
      }
      return res.json() as Promise<{ authenticated: boolean; user?: User }>;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  // Save last user when authenticated
  useEffect(() => {
    if (authData?.authenticated && authData.user) {
      saveLastUser(authData.user);
    }
  }, [authData]);

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Login failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  // Signup mutation
  const signupMutation = useMutation({
    mutationFn: async ({ email, password, name }: { email: string; password: string; name: string }) => {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, name }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Signup failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Logout failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      queryClient.clear();
    },
  });

  const login = async (email: string, password: string) => {
    await loginMutation.mutateAsync({ email, password });
  };

  const signup = async (email: string, password: string, name: string) => {
    await signupMutation.mutateAsync({ email, password, name });
  };

  const loginWithGitHub = () => {
    window.location.href = '/api/auth/github';
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  const value: AuthContextValue = {
    user: authData?.user || null,
    isLoading,
    isAuthenticated: authData?.authenticated ?? false,
    login,
    signup,
    loginWithGitHub,
    logout,
    refetch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
