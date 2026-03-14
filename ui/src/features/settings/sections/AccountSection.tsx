/**
 * Account Section
 *
 * Manage user profile, connected OAuth accounts, password, and recovery codes.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  Trash2,
  Key,
  Eye,
  EyeOff,
  Loader2,
  Terminal,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Github,
  Copy,
  Check,
  ExternalLink,
  Download,
  AlertTriangle,
  Unlock,
  FileCode,
  FileJson,
  Database,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { SettingsCard } from '../components/SettingsCard';
import { API_BASE } from '../constants';

// Types for profile API response
interface ProfileUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  bio?: string | null;
  createdAt: string;
  onboardingCompleted: boolean;
}

interface ConnectedAccount {
  provider: string;
  username: string;
  connectedAt: string;
}

interface ProfileResponse {
  user: ProfileUser;
  preferences: Record<string, unknown> | null;
  connectedAccounts: ConnectedAccount[];
  activeSessions: number;
}

// Recovery Codes sub-component
function RecoveryCodesSection() {
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [codesConfirmed, setCodesConfirmed] = useState(false);

  const { data: codesData, refetch: refetchCodes } = useQuery({
    queryKey: ['user', 'recovery-codes-count'],
    queryFn: async () => {
      const res = await fetch('/api/users/me/recovery-codes/count', {
        credentials: 'include',
      });
      if (!res.ok) return { remainingCodes: 0, hasRecoveryCodes: false };
      return res.json() as Promise<{
        remainingCodes: number;
        hasRecoveryCodes: boolean;
      }>;
    },
  });

  const regenerateCodes = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/users/me/recovery-codes/regenerate', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to regenerate codes');
      return res.json() as Promise<{
        success: boolean;
        recoveryCodes: string[];
        message: string;
      }>;
    },
    onSuccess: (data) => {
      setNewCodes(data.recoveryCodes);
      refetchCodes();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Failed to regenerate codes',
      ),
  });

  const handleRegenerate = () => {
    regenerateCodes.mutate();
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(newCodes.join('\n'));
    toast.success('Recovery codes copied to clipboard');
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  const handleDownloadTxt = () => {
    const content = [
      'profClaw Recovery Codes',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Keep these codes in a safe place. Each code can only be used once.',
      '',
      ...newCodes.map((code, i) => `${i + 1}. ${code}`),
    ].join('\n');
    downloadFile(content, 'profclaw-recovery-codes.txt', 'text/plain');
  };

  const handleDownloadJson = () => {
    const content = JSON.stringify(
      {
        app: 'profClaw',
        type: 'recovery_codes',
        generatedAt: new Date().toISOString(),
        codes: newCodes,
        warning: 'Each code can only be used once. Keep these secure.',
      },
      null,
      2,
    );
    downloadFile(content, 'profclaw-recovery-codes.json', 'application/json');
  };

  const handleDownloadCsv = () => {
    const content = [
      'index,code,status',
      ...newCodes.map((code, i) => `${i + 1},${code},unused`),
    ].join('\n');
    downloadFile(content, 'profclaw-recovery-codes.csv', 'text/csv');
  };

  const handleCloseDialog = (forceClose = false) => {
    if (!forceClose && newCodes.length > 0 && !codesConfirmed) {
      toast.error('Please confirm you have saved your recovery codes');
      return;
    }
    setShowRegenerateDialog(false);
    setNewCodes([]);
    setCodesConfirmed(false);
  };

  return (
    <>
      <SettingsCard
        title="Recovery Codes"
        description="Backup codes for account recovery if you lose access"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Key className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="font-medium">Recovery Codes</p>
                <p className="text-sm text-muted-foreground">
                  {codesData?.hasRecoveryCodes
                    ? `${codesData.remainingCodes} codes remaining`
                    : 'No recovery codes configured'}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRegenerateDialog(true)}
              className="rounded-xl"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Recovery codes can be used to regain access to your account if you
            forget your password. Each code can only be used once. Keep them in
            a safe place.
          </p>
        </div>
      </SettingsCard>

      <Dialog
        open={showRegenerateDialog}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog(newCodes.length === 0);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Key className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <DialogTitle>Recovery Codes</DialogTitle>
                <DialogDescription>
                  {newCodes.length > 0
                    ? 'Save these codes securely'
                    : 'Generate new backup codes'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {newCodes.length === 0 ? (
            <>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-500">Warning</p>
                    <p className="text-muted-foreground">
                      Regenerating codes will invalidate all existing recovery
                      codes. Make sure you save the new codes in a secure
                      location.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowRegenerateDialog(false)}
                  className="flex-1 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRegenerate}
                  disabled={regenerateCodes.isPending}
                  className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
                >
                  {regenerateCodes.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Generate New Codes
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-muted/40 rounded-xl p-4">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {newCodes.map((code, i) => (
                    <div
                      key={i}
                      className="bg-background rounded-lg px-3 py-2 text-center"
                    >
                      {code}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleCopyAll}
                  className="flex-1 rounded-xl"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy All
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="rounded-xl">
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={handleDownloadTxt}>
                      <FileCode className="h-4 w-4 mr-2" />
                      Text (.txt)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadJson}>
                      <FileJson className="h-4 w-4 mr-2" />
                      JSON (.json)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadCsv}>
                      <Database className="h-4 w-4 mr-2" />
                      CSV (.csv)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={codesConfirmed}
                  onChange={(e) => setCodesConfirmed(e.target.checked)}
                  className="mt-1 rounded"
                />
                <span className="text-sm text-muted-foreground">
                  I have saved these recovery codes in a secure location. I
                  understand they will not be shown again.
                </span>
              </label>

              <Button
                onClick={() => handleCloseDialog()}
                disabled={!codesConfirmed}
                className="w-full rounded-xl"
              >
                Done
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AccountSection() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', bio: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [showEmailChange, setShowEmailChange] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    new: '',
    confirm: '',
  });
  const [emailForm, setEmailForm] = useState({
    newEmail: '',
    currentPassword: '',
  });
  const [copiedId, setCopiedId] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const {
    data: profile,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/users/me/profile`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: 'Failed to fetch profile' }));
        throw new Error(err.error || 'Failed to fetch profile');
      }
      return res.json() as Promise<ProfileResponse>;
    },
  });

  const { data: connectedAccountsData } = useQuery({
    queryKey: ['user', 'connected-accounts'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/users/me/connected-accounts`, {
        credentials: 'include',
      });
      if (!res.ok)
        return { accounts: [], hasPassword: false, canDisconnect: false };
      return res.json() as Promise<{
        accounts: ConnectedAccount[];
        hasPassword: boolean;
        canDisconnect: boolean;
      }>;
    },
  });

  const updateProfile = useMutation({
    mutationFn: async (updates: { name?: string; bio?: string }) => {
      const res = await fetch(`${API_BASE}/api/users/me/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update profile');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', 'profile'] });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      toast.success('Profile updated');
      setIsEditing(false);
    },
    onError: () => toast.error('Failed to update profile'),
  });

  const changePassword = useMutation({
    mutationFn: async (data: {
      currentPassword?: string;
      newPassword: string;
    }) => {
      const res = await fetch(`${API_BASE}/api/users/me/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: 'Failed to change password' }));
        throw new Error(err.error || 'Failed to change password');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['user', 'connected-accounts'],
      });
      toast.success('Password updated successfully');
      setShowPasswordChange(false);
      setPasswordForm({ current: '', new: '', confirm: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const changeEmail = useMutation({
    mutationFn: async (data: {
      newEmail: string;
      currentPassword?: string;
    }) => {
      const res = await fetch(`${API_BASE}/api/users/me/email`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: 'Failed to change email' }));
        throw new Error(err.error || 'Failed to change email');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', 'profile'] });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      toast.success('Email updated successfully');
      setShowEmailChange(false);
      setEmailForm({ newEmail: '', currentPassword: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disconnectAccount = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch(
        `${API_BASE}/api/users/me/connected-accounts/${provider}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: 'Failed to disconnect' }));
        throw new Error(err.error || 'Failed to disconnect account');
      }
      return res.json();
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: ['user', 'profile'] });
      queryClient.invalidateQueries({
        queryKey: ['user', 'connected-accounts'],
      });
      toast.success(`${provider} account disconnected`);
      setDisconnecting(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setDisconnecting(null);
    },
  });

  const handleSave = async () => {
    if (!editForm.name.trim()) return;
    setIsSaving(true);
    await updateProfile.mutateAsync({
      name: editForm.name.trim(),
      bio: editForm.bio.trim(),
    });
    setIsSaving(false);
  };

  const handleEdit = () => {
    setEditForm({
      name: profile?.user?.name || '',
      bio: profile?.user?.bio || '',
    });
    setIsEditing(true);
  };

  const hasPassword = connectedAccountsData?.hasPassword ?? false;
  const canDisconnect = connectedAccountsData?.canDisconnect ?? false;

  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const togglePasswordVisibility = (field: string) => {
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const getPasswordStrength = (
    password: string,
  ): { label: string; color: string; width: string; score: number } => {
    if (!password)
      return { label: '', color: '', width: '0%', score: 0 };
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1)
      return { label: 'Weak', color: 'bg-red-500', width: '20%', score };
    if (score === 2)
      return { label: 'Fair', color: 'bg-orange-500', width: '40%', score };
    if (score === 3)
      return { label: 'Good', color: 'bg-amber-500', width: '60%', score };
    if (score === 4)
      return { label: 'Strong', color: 'bg-green-500', width: '80%', score };
    return { label: 'Very Strong', color: 'bg-emerald-500', width: '100%', score };
  };

  const passwordStrength = getPasswordStrength(passwordForm.new);
  const passwordsMatch =
    passwordForm.confirm.length > 0 && passwordForm.new === passwordForm.confirm;
  const passwordsMismatch =
    passwordForm.confirm.length > 0 && passwordForm.new !== passwordForm.confirm;

  const handlePasswordChange = () => {
    if (passwordForm.new !== passwordForm.confirm) {
      toast.error('New passwords do not match');
      return;
    }
    if (passwordForm.new.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (!/[a-zA-Z]/.test(passwordForm.new) || !/\d/.test(passwordForm.new)) {
      toast.error('Password must contain at least 1 letter and 1 number');
      return;
    }
    const data: { currentPassword?: string; newPassword: string } = {
      newPassword: passwordForm.new,
    };
    if (hasPassword) {
      data.currentPassword = passwordForm.current;
    }
    changePassword.mutate(data);
  };

  const handleEmailChange = () => {
    if (!emailForm.newEmail.trim()) {
      toast.error('Please enter a new email');
      return;
    }
    const data: { newEmail: string; currentPassword?: string } = {
      newEmail: emailForm.newEmail.trim(),
    };
    if (hasPassword) {
      data.currentPassword = emailForm.currentPassword;
    }
    changeEmail.mutate(data);
  };

  const handleDisconnect = (provider: string) => {
    if (!canDisconnect) {
      toast.error(
        'Please set a password before disconnecting your only login method',
      );
      setShowPasswordChange(true);
      return;
    }
    setDisconnecting(provider);
    disconnectAccount.mutate(provider);
  };

  const copyUserId = () => {
    if (profile?.user?.id) {
      navigator.clipboard.writeText(profile.user.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
      toast.success('User ID copied');
    }
  };

  const user = profile?.user;
  const connectedAccounts = profile?.connectedAccounts || [];
  const isFallbackEmail = user?.email?.endsWith('@github.local');

  const roleColors: Record<string, string> = {
    admin: 'bg-red-500/80 text-white border-red-400/50 backdrop-blur-xl backdrop-saturate-150 shadow-lg shadow-red-500/20',
    user: 'bg-black/60 text-white border-white/30 backdrop-blur-xl backdrop-saturate-150 shadow-lg shadow-black/20',
  };

  if (error) {
    return (
      <SettingsCard
        title="Profile"
        description="Manage your account information"
      >
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">
            Failed to load profile data
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 rounded-xl"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ['user', 'profile'] })
            }
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </SettingsCard>
    );
  }

  return (
    <>
      <SettingsCard
        title="Profile"
        description="Manage your account information"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Avatar and Name */}
            <div className="flex items-start gap-4">
              <div className="relative">
                {user?.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    className="h-20 w-20 rounded-full ring-4 ring-primary/20 object-cover"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-gradient-to-br from-primary to-primary/60 ring-4 ring-primary/20 flex items-center justify-center text-2xl font-bold text-white">
                    {user?.name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
                <span
                  className={cn(
                    'absolute -bottom-1 -right-1 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border',
                    roleColors[user?.role || 'user'] || roleColors.user,
                  )}
                >
                  {user?.role || 'user'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, name: e.target.value }))
                        }
                        className="w-full field"
                        placeholder="Your name"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Bio
                      </label>
                      <textarea
                        value={editForm.bio}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, bio: e.target.value }))
                        }
                        className="w-full field resize-none"
                        placeholder="A short bio about yourself"
                        rows={2}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving || !editForm.name.trim()}
                        className="rounded-xl"
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-1" />
                            Save
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsEditing(false)}
                        className="rounded-xl"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-semibold">
                        {user?.name || 'User'}
                      </h3>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleEdit}
                        className="h-7 px-2 rounded-lg"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        {user?.email || 'No email'}
                      </p>
                      {isFallbackEmail && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded-md border border-amber-500/20">
                          Temporary
                        </span>
                      )}
                    </div>
                    {user?.bio && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {user.bio}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Member since{' '}
                      {user?.createdAt
                        ? new Date(user.createdAt).toLocaleDateString('en-US', {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Unknown'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Fallback Email Warning */}
            {isFallbackEmail && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Update your email address
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your email is a temporary placeholder. Log out and log back
                    in with GitHub to fetch your real email, or set a custom
                    email below.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 rounded-xl h-7 text-xs"
                    onClick={() => setShowEmailChange(true)}
                  >
                    Set Email Address
                  </Button>
                </div>
              </div>
            )}

            {/* Account Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border">
              <div className="p-3 rounded-xl bg-muted/30">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground mb-1">
                    Email Address
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-xs"
                    onClick={() => setShowEmailChange(true)}
                  >
                    Change
                  </Button>
                </div>
                <p className="text-sm font-medium truncate">
                  {user?.email || 'Not set'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">
                  Active Sessions
                </p>
                <p className="text-sm font-medium">
                  {profile?.activeSessions || 1} device
                  {(profile?.activeSessions || 1) > 1 ? 's' : ''}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">
                  Account Status
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      user?.status === 'active'
                        ? 'bg-green-500'
                        : 'bg-amber-500',
                    )}
                  />
                  <p className="text-sm font-medium capitalize">
                    {user?.status || 'Active'}
                  </p>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">User ID</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-mono text-muted-foreground truncate flex-1">
                    {user?.id || 'Unknown'}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={copyUserId}
                  >
                    {copiedId ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Email Change Card */}
      {showEmailChange && (
        <SettingsCard
          title="Change Email"
          description="Update your email address"
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                New Email Address
              </label>
              <input
                type="email"
                value={emailForm.newEmail}
                onChange={(e) =>
                  setEmailForm((f) => ({ ...f, newEmail: e.target.value }))
                }
                className="w-full field"
                placeholder="your@email.com"
                autoFocus
              />
            </div>
            {hasPassword && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Current Password
                </label>
                <input
                  type="password"
                  value={emailForm.currentPassword}
                  onChange={(e) =>
                    setEmailForm((f) => ({
                      ...f,
                      currentPassword: e.target.value,
                    }))
                  }
                  className="w-full field"
                  placeholder="Enter your password to confirm"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleEmailChange}
                disabled={changeEmail.isPending || !emailForm.newEmail.trim()}
                className="rounded-xl"
              >
                {changeEmail.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Update Email'
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowEmailChange(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Connected Accounts */}
      <SettingsCard
        title="Connected Accounts"
        description="Linked external accounts for authentication"
      >
        <div className="space-y-3">
          {connectedAccounts.length > 0 ? (
            connectedAccounts.map((account) => (
              <div
                key={account.provider}
                className="flex items-center justify-between p-3 rounded-xl bg-muted/30"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#24292f] flex items-center justify-center">
                    <Github className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      @{account.username}
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Connected{' '}
                      {new Date(account.connectedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://github.com/${account.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors p-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDisconnect(account.provider)}
                    disabled={disconnecting === account.provider}
                  >
                    {disconnecting === account.provider ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No connected accounts
            </div>
          )}
          {!canDisconnect && connectedAccounts.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3" />
              Set a password before disconnecting your only login method
            </p>
          )}
        </div>
      </SettingsCard>

      {/* Password Section */}
      <SettingsCard
        title="Password"
        description={
          hasPassword
            ? 'Change your account password'
            : 'Set a password to enable email login'
        }
      >
        {showPasswordChange ? (
          <div className="space-y-4">
            {hasPassword && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showPasswords.current ? 'text' : 'password'}
                    value={passwordForm.current}
                    onChange={(e) =>
                      setPasswordForm((f) => ({ ...f, current: e.target.value }))
                    }
                    className="w-full bg-muted/40 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('current')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPasswords.current ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {hasPassword ? 'New Password' : 'Password'}
              </label>
              <div className="relative">
                <input
                  type={showPasswords.new ? 'text' : 'password'}
                  value={passwordForm.new}
                  onChange={(e) =>
                    setPasswordForm((f) => ({ ...f, new: e.target.value }))
                  }
                  className="w-full bg-muted/40 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder={
                    hasPassword
                      ? 'Enter new password'
                      : 'Create a password (min 8 characters)'
                  }
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('new')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPasswords.new ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {/* Password Strength Indicator */}
              {passwordForm.new && (
                <div className="mt-2 space-y-1.5">
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-300', passwordStrength.color)}
                      style={{ width: passwordStrength.width }}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <p className={cn(
                      'text-xs font-medium',
                      passwordStrength.score <= 1 && 'text-red-500',
                      passwordStrength.score === 2 && 'text-orange-500',
                      passwordStrength.score === 3 && 'text-amber-500',
                      passwordStrength.score >= 4 && 'text-green-500',
                    )}>
                      {passwordStrength.label}
                    </p>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span className={cn(passwordForm.new.length >= 8 ? 'text-green-500' : '')}>
                        {passwordForm.new.length >= 8 ? <CheckCircle2 className="h-3 w-3 inline mr-0.5" /> : <XCircle className="h-3 w-3 inline mr-0.5" />}
                        8+ chars
                      </span>
                      <span className={cn(/[a-zA-Z]/.test(passwordForm.new) && /\d/.test(passwordForm.new) ? 'text-green-500' : '')}>
                        {/[a-zA-Z]/.test(passwordForm.new) && /\d/.test(passwordForm.new) ? <CheckCircle2 className="h-3 w-3 inline mr-0.5" /> : <XCircle className="h-3 w-3 inline mr-0.5" />}
                        Letter + number
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showPasswords.confirm ? 'text' : 'password'}
                  value={passwordForm.confirm}
                  onChange={(e) =>
                    setPasswordForm((f) => ({ ...f, confirm: e.target.value }))
                  }
                  className={cn(
                    'w-full bg-muted/40 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors',
                    passwordsMatch && 'border-green-500/50',
                    passwordsMismatch && 'border-red-500/50',
                  )}
                  placeholder="Confirm password"
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('confirm')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPasswords.confirm ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {passwordsMismatch && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  Passwords do not match
                </p>
              )}
              {passwordsMatch && (
                <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Passwords match
                </p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={handlePasswordChange}
                disabled={
                  changePassword.isPending ||
                  !passwordForm.new ||
                  !passwordForm.confirm ||
                  passwordsMismatch ||
                  passwordForm.new.length < 8 ||
                  (hasPassword && !passwordForm.current)
                }
                className="rounded-xl"
              >
                {changePassword.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Shield className="h-4 w-4 mr-2" />
                )}
                {hasPassword ? 'Update Password' : 'Set Password'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowPasswordChange(false);
                  setPasswordForm({ current: '', new: '', confirm: '' });
                  setShowPasswords({});
                }}
                className="rounded-xl"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                'h-10 w-10 rounded-full flex items-center justify-center',
                hasPassword ? 'bg-green-500/10' : 'bg-amber-500/10',
              )}>
                {hasPassword ? (
                  <Shield className="h-5 w-5 text-green-500" />
                ) : (
                  <Unlock className="h-5 w-5 text-amber-500" />
                )}
              </div>
              <div>
                {hasPassword ? (
                  <>
                    <p className="text-sm font-medium">Password protected</p>
                    <p className="text-xs text-muted-foreground">
                      You can log in with email + password
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-amber-500">No password set</p>
                    <p className="text-xs text-muted-foreground">
                      Set one to enable email login alongside OAuth
                    </p>
                  </>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPasswordChange(true)}
              className="rounded-xl"
            >
              <Key className="h-4 w-4 mr-2" />
              {hasPassword ? 'Change' : 'Set Password'}
            </Button>
          </div>
        )}

        {/* CLI Reset Hint */}
        {hasPassword && !showPasswordChange && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/20">
              <Terminal className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground/80">Forgot your password?</p>
                <p>Ask an admin to reset it, or run this on the server:</p>
                <code className="block mt-1 px-2 py-1.5 bg-muted/40 rounded-lg font-mono text-[11px] break-all">
                  profclaw auth reset-password {profile?.user?.email || 'your@email.com'}
                </code>
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      <RecoveryCodesSection />

      {/* Support Section */}
      <SettingsCard title="Support" description="Get help with your account">
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
            <div>
              <p className="text-sm font-medium">Contact Support</p>
              <p className="text-xs text-muted-foreground">
                For account issues and questions
              </p>
            </div>
            <a
              href="mailto:support@profclaw.ai"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              support@profclaw.ai
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
            <div>
              <p className="text-sm font-medium">Documentation</p>
              <p className="text-xs text-muted-foreground">
                Guides and API reference
              </p>
            </div>
            <a
              href="https://docs.profclaw.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              docs.profclaw.ai
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {user?.role === 'admin' && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/20">
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  Admin Contact
                </p>
                <p className="text-xs text-muted-foreground">
                  System administrator
                </p>
              </div>
              <a
                href="mailto:support@profclaw.ai"
                className="text-sm text-red-600 dark:text-red-400 hover:underline flex items-center gap-1"
              >
                support@profclaw.ai
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </SettingsCard>
    </>
  );
}
