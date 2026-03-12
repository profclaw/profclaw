/**
 * Login Page
 *
 * Supports email/password and GitHub OAuth.
 * Checks if OAuth is configured before showing GitHub button.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Github, LogIn, AlertCircle, Eye, EyeOff, ArrowRight, Settings, X, Terminal, Copy, Check, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth, getLastUser, clearLastUser, type LastUser } from '../hooks/useAuth';
import { Logo } from '@/components/shared/Logo';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, loginWithGitHub, isAuthenticated, isLoading: authLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUser, setLastUser] = useState<LastUser | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Load last logged-in user
  useEffect(() => {
    const stored = getLastUser();
    if (stored) {
      setLastUser(stored);
    }
  }, []);

  // Check if GitHub OAuth is configured
  const { data: setupStatus } = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/setup/status');
      if (!res.ok) return { configured: false, providers: { github: false } };
      return res.json();
    },
    staleTime: 60000, // 1 minute
  });

  const githubConfigured = setupStatus?.providers?.github ?? false;
  const forgotPasswordEnabled = setupStatus?.showForgotPassword ?? true;

  // Check for error from OAuth callback
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      const errorMessages: Record<string, string> = {
        no_code: 'Authentication failed: no code received',
        invalid_state: 'Authentication failed: invalid state',
        auth_failed: 'GitHub authentication failed',
        callback_failed: 'Authentication callback failed',
      };
      setError(errorMessages[errorParam] || 'Authentication failed');
    }
  }, [searchParams]);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, authLoading, navigate]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login(email, password);
      toast.success('Logged in successfully');
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGitHubClick = () => {
    if (!githubConfigured) {
      toast.error('GitHub OAuth is not configured. Please contact your administrator.');
      return;
    }
    loginWithGitHub();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="flex flex-col items-center gap-4">
          <Logo className="h-12 w-12 text-[var(--primary)] animate-pulse" />
          <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] p-4">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-[var(--primary)]/5 via-transparent to-pink-500/5 pointer-events-none" />

      <div className="w-full max-w-md relative z-10 glass-heavy rounded-[2.5rem] shadow-float overflow-hidden">
        <div className="text-center pb-2 px-8 pt-8">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="p-4 rounded-[2rem] glass-heavy shadow-2xl shadow-primary/10 transition-transform hover:scale-110">
              <Logo className="h-12 w-12 text-[var(--primary)]" aria-label="profClaw Logo" />
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase tracking-[0.1em]">Welcome back</h1>
          <p className="text-sm text-[var(--muted-foreground)] font-semibold mt-1">
            Sign in to your profClaw account
          </p>
        </div>

        <div className="space-y-6 px-8 pb-8 pt-4">
          {error && (
            <div className="flex items-center gap-3 p-4 bg-destructive/5 text-destructive text-sm font-bold rounded-2xl shadow-inner animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Continue as last user */}
          {lastUser && !lastUser.email.endsWith('@github.local') && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setEmail(lastUser.email);
                  // Focus the password field
                  setTimeout(() => {
                    document.getElementById('password')?.focus();
                  }, 100);
                }}
                className="w-full flex items-center gap-3 p-4 glass hover:bg-white/10 dark:hover:bg-black/20 rounded-2xl transition-all text-left group shadow-lg"
              >
                {lastUser.avatarUrl ? (
                  <img
                    src={lastUser.avatarUrl}
                    alt={lastUser.name}
                    className="h-12 w-12 rounded-2xl object-cover shadow-md"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-pink-500 flex items-center justify-center shadow-md">
                    <span className="text-lg font-black text-white">
                      {lastUser.name?.charAt(0).toUpperCase() || 'U'}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-black text-[var(--foreground)] truncate uppercase tracking-wider text-xs">
                    Continue as {lastUser.name}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)] truncate font-medium">
                    {lastUser.email}
                  </p>
                </div>
                <ArrowRight className="h-4.5 w-4.5 text-[var(--muted-foreground)] group-hover:text-[var(--primary)] transition-all group-hover:translate-x-1" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearLastUser();
                  setLastUser(null);
                }}
                className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-[var(--background)] border border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)] hover:text-destructive transition-all shadow-md active:scale-90 z-10"
                title="Dismiss"
                aria-label="Dismiss last user"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* GitHub OAuth - Primary CTA */}
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className={cn(
                "w-full gap-3 h-14 rounded-2xl glass-heavy text-base font-black uppercase tracking-widest text-[12px] transition-all border-none shadow-xl",
                githubConfigured
                  ? "hover:bg-[var(--primary)]/10 hover:shadow-primary/5 active:scale-95"
                  : "opacity-40 cursor-not-allowed"
              )}
              onClick={handleGitHubClick}
              disabled={!githubConfigured}
            >
              <Github className="h-5 w-5" />
              Continue with GitHub
              {githubConfigured && <ArrowRight className="h-4 w-4 ml-auto opacity-50" />}
            </Button>
            {!githubConfigured && (
              <button
                onClick={() => navigate('/setup')}
                className="w-full text-[10px] text-center text-[var(--muted-foreground)] flex items-center justify-center gap-1.5 py-1 hover:text-[var(--primary)] transition-colors group font-black uppercase tracking-widest"
                aria-label="GitHub OAuth not configured. Click to configure now."
              >
                <Settings className="h-3 w-3 group-hover:animate-spin" />
                <span>GitHub OAuth not configured.</span>
                <span className="text-[var(--primary)] underline-offset-4 decoration-2">Configure now</span>
              </button>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full h-px bg-gradient-to-r from-transparent via-[var(--border)]/20 to-transparent" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-black">
              <span className="bg-[var(--card)] px-4 text-[var(--muted-foreground)]/60">
                Or continue with email
              </span>
            </div>
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleEmailLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="premium-label">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@profclaw.ai"
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <Label htmlFor="password" className="premium-label">Password</Label>
                {forgotPasswordEnabled && (
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(true)}
                    className="text-[10px] font-black uppercase tracking-widest text-[var(--primary)] hover:opacity-80 transition-opacity"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="black"
              className="w-full mt-2"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Sign in
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-[10px] font-black uppercase tracking-widest text-[var(--muted-foreground)]/60">
            Don't have an account?{' '}
            <Link to="/signup" className="text-[var(--primary)] hover:opacity-80 transition-opacity">
              Sign up
            </Link>
          </p>

          {/* Legal Links */}
          <div className="pt-6 border-t border-[var(--border)]/10 text-center space-y-2">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-[var(--muted-foreground)]/40 leading-relaxed">
              By signing in, you agree to our{' '}
              <Link to="/terms" className="text-[var(--primary)] hover:opacity-80">
                Terms
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="text-[var(--primary)] hover:opacity-80">
                Privacy
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-[var(--card)] rounded-2xl border border-[var(--border)] shadow-xl w-full max-w-lg p-6 relative animate-in fade-in zoom-in-95">
            <button
              type="button"
              onClick={() => setShowForgotPassword(false)}
              className="absolute top-4 right-4 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <KeyRound className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Reset Your Password</h3>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Contact your admin or use the CLI
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Option 1: Ask Admin */}
              <div className="p-4 rounded-xl bg-[var(--muted)]/30 border border-[var(--border)]">
                <p className="text-sm font-semibold mb-1">Option 1: Ask your administrator</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  An admin can reset your password from the User Management page or via the CLI.
                </p>
              </div>

              {/* Option 2: CLI */}
              <div className="p-4 rounded-xl bg-[var(--muted)]/30 border border-[var(--border)]">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="h-4 w-4 text-[var(--primary)]" />
                  <p className="text-sm font-semibold">Option 2: CLI (server access required)</p>
                </div>
                <p className="text-xs text-[var(--muted-foreground)] mb-3">
                  If you have access to the server, run this command to generate a temporary password:
                </p>

                <div className="space-y-2">
                  <div className="relative">
                    <code className="block w-full p-3 bg-[var(--background)] border border-[var(--border)] rounded-lg text-xs font-mono break-all pr-10">
                      profclaw auth reset-password your@email.com
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText('profclaw auth reset-password your@email.com');
                        setCopiedCmd('reset');
                        setTimeout(() => setCopiedCmd(null), 2000);
                        toast.success('Command copied');
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-[var(--muted)] transition-colors"
                    >
                      {copiedCmd === 'reset' ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                      )}
                    </button>
                  </div>

                  <p className="text-xs text-[var(--muted-foreground)]">
                    Or if using npx directly:
                  </p>

                  <div className="relative">
                    <code className="block w-full p-3 bg-[var(--background)] border border-[var(--border)] rounded-lg text-xs font-mono break-all pr-10">
                      npx tsx src/cli/index.ts auth reset-password your@email.com
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText('npx tsx src/cli/index.ts auth reset-password your@email.com');
                        setCopiedCmd('npx');
                        setTimeout(() => setCopiedCmd(null), 2000);
                        toast.success('Command copied');
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-[var(--muted)] transition-colors"
                    >
                      {copiedCmd === 'npx' ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                      )}
                    </button>
                  </div>
                </div>

                <p className="text-xs text-amber-500 mt-3 flex items-start gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  This generates a temporary password and new recovery codes. All existing sessions are invalidated.
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full rounded-xl"
                onClick={() => setShowForgotPassword(false)}
              >
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
