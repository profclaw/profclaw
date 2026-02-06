/**
 * Signup Page
 *
 * Create new account with email/password or GitHub.
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Github, AlertCircle, Check, Eye, EyeOff, ArrowRight, Sparkles, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '../hooks/useAuth';
import { Logo } from '@/components/shared/Logo';

const PASSWORD_REQUIREMENTS = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'Contains a number', test: (p: string) => /\d/.test(p) },
  { label: 'Contains a letter', test: (p: string) => /[a-zA-Z]/.test(p) },
];

export function SignupPage() {
  const navigate = useNavigate();
  const { signup, loginWithGitHub, isAuthenticated, isLoading: authLoading } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);

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

  const handleGitHubClick = () => {
    if (!githubConfigured) {
      navigate('/setup');
      return;
    }
    loginWithGitHub();
  };

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, authLoading, navigate]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate password
    const allPassed = PASSWORD_REQUIREMENTS.every(req => req.test(password));
    if (!allPassed) {
      setError('Password does not meet requirements');
      return;
    }

    setIsLoading(true);

    try {
      await signup(email, password, name);
      toast.success('Account created successfully');
      navigate('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setIsLoading(false);
    }
  };

  const passwordStrength = PASSWORD_REQUIREMENTS.filter(req => req.test(password)).length;
  const passwordStrengthPercent = (passwordStrength / PASSWORD_REQUIREMENTS.length) * 100;

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
              <Logo className="h-12 w-12 text-[var(--primary)]" aria-label="GLINR Logo" />
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase tracking-[0.1em]">Create account</h1>
          <p className="text-sm text-[var(--muted-foreground)] font-semibold mt-1">
            Get started with GLINR for free
          </p>
        </div>

        <div className="space-y-6 px-8 pb-8 pt-4">
          {error && (
            <div className="flex items-center gap-3 p-4 bg-destructive/5 text-destructive text-sm font-bold rounded-2xl shadow-inner animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
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
          <form onSubmit={handleSignup} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-widest text-[var(--muted-foreground)] px-1">
                Full Name
              </Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={() => setFocusedField('name')}
                onBlur={() => setFocusedField(null)}
                placeholder="John Doe"
                required
                autoComplete="name"
                className={cn(
                  "h-12 border-none glass-heavy rounded-2xl shadow-inner transition-all px-4 font-bold focus:shadow-xl focus:shadow-primary/5 focus:scale-[1.01]",
                  focusedField === 'name' && "bg-white/50 dark:bg-black/50"
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-[var(--muted-foreground)] px-1">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                placeholder="you@glinr.ai"
                required
                autoComplete="email"
                className={cn(
                  "h-12 border-none glass-heavy rounded-2xl shadow-inner transition-all px-4 font-bold focus:shadow-xl focus:shadow-primary/5 focus:scale-[1.01]",
                  focusedField === 'email' && "bg-white/50 dark:bg-black/50"
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-[var(--muted-foreground)] px-1">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  className={cn(
                    "h-12 border-none glass-heavy rounded-2xl shadow-inner transition-all px-4 font-bold pr-12 focus:shadow-xl focus:shadow-primary/5 focus:scale-[1.01]",
                    focusedField === 'password' && "bg-white/50 dark:bg-black/50"
                  )}
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

              {/* Password strength bar */}
              {password.length > 0 && (
                <div className="space-y-2 mt-3">
                  <div className="h-1 bg-[var(--muted)]/50 rounded-full overflow-hidden shadow-inner">
                    <div
                      className={cn(
                        "h-full transition-all duration-700 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.1)]",
                        passwordStrengthPercent < 50 && "bg-red-500",
                        passwordStrengthPercent >= 50 && passwordStrengthPercent < 100 && "bg-yellow-500",
                        passwordStrengthPercent === 100 && "bg-emerald-500 shadow-[0_0_15px_var(--success-glow)]"
                      )}
                      style={{ width: `${passwordStrengthPercent}%` }}
                    />
                  </div>

                  {/* Password requirements */}
                  <div className="grid grid-cols-1 gap-1">
                    {PASSWORD_REQUIREMENTS.map((req, i) => {
                      const passed = req.test(password);
                      return (
                        <div
                          key={i}
                          className={cn(
                            'flex items-center gap-2 text-xs transition-all',
                            passed ? 'text-green-600' : 'text-[var(--muted-foreground)]'
                          )}
                        >
                          <div className={cn(
                            "h-4 w-4 rounded-full flex items-center justify-center transition-all",
                            passed ? "bg-green-500/20" : "bg-[var(--muted)]"
                          )}>
                            <Check className={cn('h-2.5 w-2.5', passed ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                          </div>
                          {req.label}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <Button
              type="submit"
              variant="black"
              className="w-full mt-4"
              disabled={isLoading || passwordStrengthPercent < 100}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Create Account
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-[10px] font-black uppercase tracking-widest text-[var(--muted-foreground)]/60 pt-2 text-center">
            Already have an account?{' '}
            <Link to="/login" className="text-[var(--primary)] hover:opacity-80 transition-opacity">
              Sign in
            </Link>
          </p>

          <div className="pt-6 border-t border-[var(--border)]/10 text-center space-y-2">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-[var(--muted-foreground)]/40 leading-relaxed">
              By signing up, you agree to our{' '}
              <Link to="/terms" className="text-[var(--primary)] hover:opacity-80">Terms</Link>
              {' '}and{' '}
              <Link to="/privacy" className="text-[var(--primary)] hover:opacity-80">Privacy</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
