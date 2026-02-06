/**
 * Setup Wizard
 *
 * First-time setup for configuring OAuth and other settings.
 * Shows visual step-by-step guide for GitHub OAuth setup.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  CheckCircle,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  Github,
  Sparkles,
  Settings,
  Shield,
  Download,
  AlertTriangle,
  Key,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/shared/Logo';

interface SetupStatus {
  configured: boolean;  // GitHub OAuth configured
  hasAdmin: boolean;    // Admin user exists
  ready: boolean;       // Fully configured
  providers?: {
    github: boolean;
    jira: boolean;
    linear: boolean;
  };
}

const SETUP_STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'github', title: 'GitHub OAuth' },
  { id: 'admin', title: 'Admin Account' },
  { id: 'complete', title: 'Complete' },
];

const PASSWORD_REQUIREMENTS = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'Contains a number', test: (p: string) => /\d/.test(p) },
  { label: 'Contains a letter', test: (p: string) => /[a-zA-Z]/.test(p) },
];

export function SetupWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Form state
  const [githubClientId, setGithubClientId] = useState('');
  const [githubClientSecret, setGithubClientSecret] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminName, setAdminName] = useState('');

  // Recovery codes from admin creation
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCodesConfirmed, setRecoveryCodesConfirmed] = useState(false);

  // Check setup status
  const { data: setupStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/setup/status');
      if (!res.ok) throw new Error('Failed to check setup status');
      return res.json() as Promise<SetupStatus>;
    },
  });

  // Validation state for GitHub OAuth
  const [oauthValidationError, setOauthValidationError] = useState<string | null>(null);
  const [oauthValidationHint, setOauthValidationHint] = useState<string | null>(null);

  // Save GitHub OAuth config (with validation first)
  const saveGithubOAuth = useMutation({
    mutationFn: async (data: { clientId: string; clientSecret: string }) => {
      setOauthValidationError(null);
      setOauthValidationHint(null);

      // Step 1: Validate credentials
      const validateRes = await fetch('/api/setup/github-oauth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const validateJson = await validateRes.json() as {
        valid: boolean;
        error?: string;
        hint?: string;
        warning?: string;
        message?: string;
      };

      if (!validateJson.valid) {
        setOauthValidationError(validateJson.error || 'Invalid credentials');
        setOauthValidationHint(validateJson.hint || null);
        throw new Error(validateJson.error || 'Invalid credentials');
      }

      // Show warning if any
      if (validateJson.warning) {
        toast.warning(validateJson.warning);
      }

      // Step 2: Save credentials
      const res = await fetch('/api/setup/github-oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        // If already configured, that's actually fine - move to next step
        if (res.status === 403 && json.error?.includes('already configured')) {
          return { alreadyConfigured: true };
        }
        throw new Error(json.error || 'Failed to save GitHub OAuth config');
      }
      return json;
    },
    onSuccess: (data) => {
      setOauthValidationError(null);
      setOauthValidationHint(null);
      if (data?.alreadyConfigured) {
        toast.info('GitHub OAuth is already configured');
      } else {
        toast.success('GitHub OAuth configured successfully!');
      }
      refetchStatus();
      setCurrentStep(2);
    },
    onError: (error) => {
      // Error already shown via validation state
      if (!oauthValidationError) {
        toast.error(error instanceof Error ? error.message : 'Failed to configure');
      }
    },
  });

  // Create admin user
  const createAdmin = useMutation({
    mutationFn: async (data: { email: string; password: string; name: string }) => {
      const res = await fetch('/api/setup/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create admin');
      }
      return res.json() as Promise<{
        success: boolean;
        recoveryCodes?: string[];
        session?: { token: string };
      }>;
    },
    onSuccess: (data) => {
      toast.success('Admin account created!');
      // Store recovery codes - shown only once
      if (data.recoveryCodes) {
        setRecoveryCodes(data.recoveryCodes);
      }
      // Store session token
      if (data.session?.token) {
        localStorage.setItem('glinr_session', data.session.token);
      }
      refetchStatus();
      setCurrentStep(3);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create admin');
    },
  });

  // Get callback URL for GitHub OAuth
  const callbackUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/auth/github/callback`
    : 'http://localhost:3000/api/auth/github/callback';

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
    toast.success('Copied to clipboard');
  };

  // Check if GitHub OAuth is already configured
  const isOAuthConfigured = setupStatus?.configured || setupStatus?.providers?.github;

  // Auto-advance to correct step based on what's already configured
  useEffect(() => {
    if (!setupStatus) return;

    // DON'T navigate away if we have recovery codes to show!
    // This is critical - user MUST see their recovery codes before leaving
    if (recoveryCodes.length > 0 && !recoveryCodesConfirmed) {
      // Stay on step 3 to show recovery codes
      if (currentStep !== 3) {
        setCurrentStep(3);
      }
      return;
    }

    // Fully configured AND user has confirmed recovery codes - go to dashboard
    if (setupStatus.ready && (recoveryCodesConfirmed || recoveryCodes.length === 0)) {
      navigate('/');
      return;
    }

    // Determine which step we should be on based on completed config
    let targetStep = 0;

    // Past welcome screen by default
    if (currentStep === 0) {
      targetStep = 1;
    }

    // GitHub OAuth is configured - skip to step 2 (admin)
    if (setupStatus.configured || setupStatus.providers?.github) {
      targetStep = 2;
    }

    // Both configured but not "ready" - go to complete
    if ((setupStatus.configured || setupStatus.providers?.github) && setupStatus.hasAdmin) {
      targetStep = 3;
    }

    // Advance if we're behind where we should be
    if (targetStep > currentStep) {
      setCurrentStep(targetStep);
    }
  }, [setupStatus, navigate, currentStep, recoveryCodes, recoveryCodesConfirmed]);

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6 text-center py-8">
            <div className="mx-auto w-24 h-24 rounded-[2rem] glass-heavy shadow-2xl flex items-center justify-center transition-transform hover:scale-110">
              <Sparkles className="h-12 w-12 text-[var(--primary)]" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Welcome to GLINR</h2>
              <p className="text-[var(--muted-foreground)] max-w-sm mx-auto">
                Let's get you set up in just a few minutes. We'll configure
                authentication so you can start managing tasks with AI.
              </p>
            </div>
            <div className="flex items-center justify-center gap-6 pt-2">
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <Shield className="h-4 w-4 text-green-500" />
                <span>Secure setup</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <Settings className="h-4 w-4 text-[var(--primary)]" />
                <span>2-3 minutes</span>
              </div>
            </div>
            <Button onClick={() => setCurrentStep(1)} className="mt-4 h-11 px-8 gap-2">
              Get Started <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
                <Github className="h-6 w-6 text-[var(--primary)]" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">Configure GitHub OAuth</h2>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Create a GitHub OAuth App to enable sign-in
                </p>
              </div>
            </div>

            {/* Already configured banner */}
            {isOAuthConfigured && (
              <div className="flex items-center justify-between gap-4 glass-heavy bg-green-500/5 rounded-[2rem] p-6 shadow-2xl shadow-green-500/5 transition-all hover:shadow-green-500/10">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-green-500/20 flex items-center justify-center shadow-inner">
                    <CheckCircle className="h-6 w-6 text-green-500 shrink-0" />
                  </div>
                  <div className="text-sm">
                    <p className="font-black uppercase tracking-widest text-[11px] text-green-600 dark:text-green-400">
                      GitHub Configured
                    </p>
                    <p className="text-[var(--muted-foreground)] font-medium">
                      You're all set! Skip to admin creation.
                    </p>
                  </div>
                </div>
                <Button onClick={() => setCurrentStep(2)} variant="black" size="sm" className="shrink-0 gap-1.5">
                  Skip <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* Step-by-step instructions */}
            <div className="space-y-6 glass-heavy rounded-[2rem] p-6 shadow-xl">
              <h3 className="font-black uppercase tracking-widest text-[10px] flex items-center gap-4 px-1 text-[var(--muted-foreground)]">
                <span className="h-7 w-7 rounded-full field-recessed flex items-center justify-center text-[var(--primary)] text-xs font-black shadow-sm">1</span>
                Step One: Create GitHub OAuth App
              </h3>
              <div className="space-y-4 ml-9 text-sm">
                <p className="text-[var(--muted-foreground)] leading-relaxed">
                  Go to{' '}
                  <a
                    href="https://github.com/settings/developers"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--primary)] hover:underline inline-flex items-center gap-1 font-bold"
                  >
                    GitHub Developer Settings
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {' '}and click <strong className="text-[var(--foreground)]">"New OAuth App"</strong>
                </p>

                {/* Config values */}
                <div className="space-y-1 field-recessed p-1 shadow-inner overflow-hidden">
                  <div className="flex items-center justify-between p-3 hover:bg-white/5 dark:hover:bg-black/20 rounded-xl transition-colors">
                    <span className="text-[var(--muted-foreground)] font-black uppercase tracking-widest text-[9px]">Application name</span>
                    <code className="text-xs font-bold text-[var(--foreground)] px-2 opacity-80">GLINR Task Manager</code>
                  </div>
                  <div className="flex items-center justify-between p-3 hover:bg-white/5 dark:hover:bg-black/20 rounded-xl transition-colors">
                    <span className="text-[var(--muted-foreground)] font-black uppercase tracking-widest text-[9px]">Homepage URL</span>
                    <div className="flex items-center gap-3">
                      <code className="text-[11px] font-bold opacity-70">
                        {window.location.origin}
                      </code>
                      <button
                        onClick={() => handleCopy(window.location.origin, 'homepage')}
                        className="p-2 glass hover:bg-primary/20 rounded-xl transition-all active:scale-90"
                      >
                        {copied === 'homepage' ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 opacity-50" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 hover:bg-white/5 dark:hover:bg-black/20 rounded-xl transition-colors">
                    <span className="text-[var(--muted-foreground)] font-black uppercase tracking-widest text-[9px]">Callback URL</span>
                    <div className="flex items-center gap-3">
                      <code className="text-[11px] font-bold opacity-70 max-w-[200px] truncate">
                        {callbackUrl}
                      </code>
                      <button
                        onClick={() => handleCopy(callbackUrl, 'callback')}
                        className="p-2 glass hover:bg-primary/20 rounded-xl transition-all active:scale-90"
                      >
                        {copied === 'callback' ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 opacity-50" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <p className="text-[var(--muted-foreground)]">
                  Click <strong>"Register application"</strong> then copy the Client ID and generate a Client Secret.
                </p>
              </div>
            </div>

            {/* Credentials input */}
            <div className="space-y-6">
              <h3 className="font-black uppercase tracking-widest text-[10px] flex items-center gap-4 px-1 text-[var(--muted-foreground)]">
                <span className="h-7 w-7 rounded-full glass-heavy shadow-inner flex items-center justify-center text-[var(--primary)] text-xs font-black">2</span>
                Step Two: Enter your credentials
              </h3>
              <div className="space-y-4 ml-9">
                <div className="space-y-2">
                  <Label htmlFor="clientId" className="premium-label">Client ID</Label>
                  <Input
                    id="clientId"
                    placeholder="20 character hex string"
                    value={githubClientId}
                    onChange={(e) => {
                      setGithubClientId(e.target.value);
                      setOauthValidationError(null);
                    }}
                    className={cn(oauthValidationError && "shadow-xl shadow-red-500/20")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientSecret" className="premium-label">Client Secret</Label>
                  <div className="relative">
                    <Input
                      id="clientSecret"
                      type={showClientSecret ? 'text' : 'password'}
                      placeholder="40 character hex string"
                      value={githubClientSecret}
                      onChange={(e) => {
                        setGithubClientSecret(e.target.value);
                        setOauthValidationError(null);
                      }}
                      className={cn(oauthValidationError && "shadow-xl shadow-red-500/20")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowClientSecret(!showClientSecret)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors p-1"
                    >
                      {showClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Validation Error Display */}
                {oauthValidationError && (
                  <div className="flex items-start gap-4 glass-heavy bg-destructive/5 rounded-2xl p-5 shadow-inner">
                    <AlertTriangle className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-black uppercase tracking-widest text-[11px] text-red-600 dark:text-red-400">
                        Configuration Error
                      </p>
                      <p className="font-bold text-red-500/80 mt-1">
                        {oauthValidationError}
                      </p>
                      {oauthValidationHint && (
                        <p className="text-[var(--muted-foreground)] mt-2 font-medium opacity-70">
                          {oauthValidationHint}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-8 mt-4 border-t border-white/5 dark:border-white/5">
              <Button variant="ghost" onClick={() => setCurrentStep(0)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button
                variant="black"
                onClick={() => saveGithubOAuth.mutate({
                  clientId: githubClientId,
                  clientSecret: githubClientSecret,
                })}
                disabled={!githubClientId || !githubClientSecret || saveGithubOAuth.isPending}
                className="gap-2"
              >
                {saveGithubOAuth.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Save & Continue <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
                <Shield className="h-6 w-6 text-[var(--primary)]" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">Create Admin Account</h2>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Set up your administrator account
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="adminName" className="text-[10px] font-black uppercase tracking-widest text-[var(--muted-foreground)] px-1">Full Name</Label>
                <Input
                  id="adminName"
                  placeholder="John Doe"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminEmail" className="text-[10px] font-black uppercase tracking-widest text-[var(--muted-foreground)] px-1">Email</Label>
                <Input
                  id="adminEmail"
                  type="email"
                  placeholder="admin@glinr.ai"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminPassword" className="text-[10px] font-black uppercase tracking-widest text-[var(--muted-foreground)] px-1">Password</Label>
                <div className="relative">
                  <Input
                    id="adminPassword"
                    type={showAdminPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                  >
                    {showAdminPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>

                {/* Password strength indicator */}
                {adminPassword.length > 0 && (
                  <div className="space-y-2 mt-3">
                    <div className="h-1.5 bg-[var(--muted)] rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all duration-300 rounded-full",
                          PASSWORD_REQUIREMENTS.filter(req => req.test(adminPassword)).length < 2 && "bg-red-500",
                          PASSWORD_REQUIREMENTS.filter(req => req.test(adminPassword)).length === 2 && "bg-yellow-500",
                          PASSWORD_REQUIREMENTS.filter(req => req.test(adminPassword)).length === 3 && "bg-green-500"
                        )}
                        style={{ width: `${(PASSWORD_REQUIREMENTS.filter(req => req.test(adminPassword)).length / PASSWORD_REQUIREMENTS.length) * 100}%` }}
                      />
                    </div>

                    {/* Password requirements */}
                    <div className="grid grid-cols-1 gap-1">
                      {PASSWORD_REQUIREMENTS.map((req, i) => {
                        const passed = req.test(adminPassword);
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
                              <Check className={cn('h-2.5 w-2.5', passed ? 'opacity-100' : 'opacity-0')} />
                            </div>
                            {req.label}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-8 mt-4 border-t border-white/5 dark:border-white/5">
              <Button variant="ghost" onClick={() => setCurrentStep(1)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button
                variant="black"
                onClick={() => createAdmin.mutate({
                  email: adminEmail,
                  password: adminPassword,
                  name: adminName,
                })}
                disabled={
                  !adminEmail ||
                  !adminPassword ||
                  !adminName ||
                  !PASSWORD_REQUIREMENTS.every(req => req.test(adminPassword)) ||
                  createAdmin.isPending
                }
                className="gap-2"
              >
                {createAdmin.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Create Account <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6 py-4">
            {/* Recovery Codes Section */}
            {recoveryCodes.length > 0 && !recoveryCodesConfirmed ? (
              <>
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                    <Key className="h-6 w-6 text-amber-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Save Your Recovery Codes</h2>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      Store these codes in a safe place
                    </p>
                  </div>
                </div>

                {/* Warning Banner */}
                <div className="flex items-start gap-4 glass-heavy bg-amber-500/5 rounded-[2rem] p-6 shadow-xl">
                  <AlertTriangle className="h-7 w-7 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-black uppercase tracking-widest text-[11px] text-amber-600 dark:text-amber-400">
                      Single Opportunity - Read Carefuly
                    </p>
                    <p className="font-bold text-amber-500/80 mt-1">
                      These codes will only be shown once!
                    </p>
                    <p className="text-[var(--muted-foreground)] mt-3 font-medium opacity-70 leading-relaxed text-xs">
                      If you lose your password, you'll need these codes to recover your account.
                      Save them in a secure password manager or write them down.
                    </p>
                  </div>
                </div>

                {/* Recovery Codes Grid */}
                <div className="glass-heavy rounded-[2rem] p-6 shadow-inner">
                  <div className="grid grid-cols-2 gap-3">
                    {recoveryCodes.map((code, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between glass-heavy rounded-xl px-4 py-3 shadow-sm hover:shadow-md transition-all group"
                      >
                        <span className="font-black text-[13px] tracking-widest opacity-80">{code}</span>
                        <button
                          onClick={() => handleCopy(code, `code-${i}`)}
                          className="p-1.5 glass hover:bg-primary/20 rounded-lg transition-all active:scale-90"
                        >
                          {copied === `code-${i}` ? (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 opacity-30 group-hover:opacity-100 transition-opacity" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => handleCopy(recoveryCodes.join('\n'), 'all-codes')}
                  >
                    {copied === 'all-codes' ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    Copy All Codes
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => {
                      const blob = new Blob([
                        `GLINR Recovery Codes\n`,
                        `=====================\n`,
                        `Account: ${adminEmail}\n\n`,
                        recoveryCodes.join('\n'),
                        `\n\nGenerated: ${new Date().toISOString()}`,
                      ], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'glinr-recovery-codes.txt';
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success('Recovery codes downloaded');
                    }}
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                </div>

                <Button
                  variant="black"
                  onClick={() => setRecoveryCodesConfirmed(true)}
                  className="w-full gap-2 mt-2"
                >
                  I've Saved My Recovery Codes <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            ) : (
              /* Setup Complete */
              <>
                <div className="text-center">
                  <div className="mx-auto w-20 h-20 rounded-2xl bg-green-500/10 flex items-center justify-center">
                    <CheckCircle className="h-10 w-10 text-green-500" />
                  </div>
                  <div className="space-y-2 mt-6">
                    <h2 className="text-2xl font-bold tracking-tight">Setup Complete!</h2>
                    <p className="text-[var(--muted-foreground)] max-w-sm mx-auto">
                      GLINR is ready to use. You can now sign in and start managing your tasks.
                    </p>
                  </div>
                </div>
                <div className="space-y-4 glass-heavy rounded-[2rem] p-8 text-left shadow-inner">
                  <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full glass-heavy flex items-center justify-center shadow-inner">
                      <Check className="h-4 w-4 text-green-500" />
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--muted-foreground)]">GitHub OAuth Active</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full glass-heavy flex items-center justify-center shadow-inner">
                      <Check className="h-4 w-4 text-green-500" />
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--muted-foreground)]">Admin Identity Secure</span>
                  </div>
                  {recoveryCodes.length > 0 && (
                    <div className="flex items-center gap-4">
                      <div className="h-8 w-8 rounded-full glass-heavy flex items-center justify-center shadow-inner">
                        <Check className="h-4 w-4 text-green-500" />
                      </div>
                      <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--muted-foreground)]">Recovery Vault Sealed</span>
                    </div>
                  )}
                </div>
                <Button variant="black" onClick={() => navigate('/')} className="w-full gap-2">
                  Go to Dashboard <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-4">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-[var(--primary)]/5 via-transparent to-pink-500/5 pointer-events-none" />

      <div className="w-full max-w-xl relative z-10">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <div className="p-6 rounded-[2.5rem] glass-heavy shadow-2xl transition-transform hover:scale-110">
            <Logo className="h-14 w-14 text-[var(--primary)]" />
          </div>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-1 mb-6">
          {SETUP_STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex items-center justify-center w-12 h-12 rounded-[1.25rem] transition-all duration-500 border-none shadow-xl',
                    index < currentStep
                      ? 'bg-primary text-white shadow-primary/30 scale-90 opacity-50'
                      : index === currentStep
                      ? 'glass-heavy text-primary scale-110 ring-4 ring-primary/10 shadow-primary/20'
                      : 'glass opacity-30 text-[var(--muted-foreground)]'
                  )}
                >
                  {index < currentStep ? (
                    <Check className="h-6 w-6" />
                  ) : (
                    <span className="text-sm font-black">{index + 1}</span>
                  )}
                </div>
                <span className={cn(
                  "text-[9px] mt-3 font-black uppercase tracking-[0.15em] transition-all duration-500",
                  index === currentStep ? "text-[var(--primary)] scale-105" : "text-[var(--muted-foreground)] opacity-40"
                )}>
                  {step.title}
                </span>
              </div>
              {index < SETUP_STEPS.length - 1 && (
                <div
                  className={cn(
                    'w-12 h-0.5 mx-2 mb-7 rounded-full transition-all duration-700',
                    index < currentStep ? 'bg-primary' : 'bg-[var(--border)]/10'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="glass-heavy rounded-[3rem] p-10 shadow-float overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="relative z-10">{renderStep()}</div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[var(--muted-foreground)] mt-6">
          Already have an account?{' '}
          <button onClick={() => navigate('/login')} className="text-[var(--primary)] hover:underline font-medium">
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
