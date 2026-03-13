/**
 * Access Key Page
 *
 * Minimal single-input page for local mode access key verification.
 * Shown when an access key is set but user has no valid session.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, KeyRound, ArrowRight, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import { Logo } from '@/components/shared/Logo';

export function AccessKeyPage() {
  const navigate = useNavigate();
  const { verifyAccessKey, isAuthenticated, isLoading: authLoading } = useAuth();

  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  if (!authLoading && isAuthenticated) {
    navigate('/');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await verifyAccessKey(key);
      toast.success('Access verified');
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid access key');
    } finally {
      setIsLoading(false);
    }
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

      <div className="w-full max-w-sm relative z-10 glass-heavy rounded-[2.5rem] shadow-float overflow-hidden">
        <div className="text-center pb-2 px-8 pt-8">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="p-4 rounded-[2rem] glass-heavy shadow-2xl shadow-primary/10 transition-transform hover:scale-110">
              <Logo className="h-12 w-12 text-[var(--primary)]" aria-label="profClaw Logo" />
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase tracking-[0.1em]">Welcome</h1>
          <p className="text-sm text-[var(--muted-foreground)] font-semibold mt-1">
            Enter your access key to continue
          </p>
        </div>

        <div className="space-y-6 px-8 pb-8 pt-4">
          {error && (
            <div className="flex items-center gap-3 p-4 bg-destructive/5 text-destructive text-sm font-bold rounded-2xl shadow-inner animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <div className="relative">
                <Input
                  id="access-key"
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Enter access key"
                  required
                  autoComplete="current-password"
                  autoFocus
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                  aria-label={showKey ? 'Hide access key' : 'Show access key'}
                >
                  {showKey ? (
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
              disabled={isLoading || !key}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  Access Dashboard
                  <ArrowRight className="h-4 w-4 ml-auto opacity-50" />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
