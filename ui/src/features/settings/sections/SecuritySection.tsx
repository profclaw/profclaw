/**
 * Security Section
 *
 * Configure tool execution security modes, allowlists, and rate limits.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  CheckCircle2,
  RefreshCw,
  Plus,
  Trash,
  Terminal,
  Globe,
  FileCode,
  Container,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldOff,
  Unlock,
  Activity,
  Clock,
  Timer,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { ElementType } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { SettingsCard } from '../components/SettingsCard';
import { ToggleOption } from '../components/ToggleOption';
import { useAuth } from '@/features/auth/hooks/useAuth';

type SecurityMode = 'deny' | 'sandbox' | 'allowlist' | 'ask' | 'full';

interface SecurityPolicy {
  mode: SecurityMode;
  askTimeout?: number;
  allowlistCount?: number;
  sandboxEnabled?: boolean;
}

interface AllowlistEntry {
  pattern: string;
  type: 'command' | 'path' | 'url';
  description?: string;
  addedAt: string;
}

interface SandboxStatus {
  available: boolean;
  image: string;
  poolSize: number;
  activeContainers: number;
}

interface PoolStatus {
  running: number;
  queued: number;
  maxConcurrent: number;
  maxQueueSize: number;
}

interface RateLimitConfig {
  enabled: boolean;
  userLimit: number;
  conversationLimit: number;
  globalLimit: number;
}

const SECURITY_MODES: {
  mode: SecurityMode;
  label: string;
  description: string;
  icon: ElementType;
  color: string;
}[] = [
  {
    mode: 'deny',
    label: 'Deny All',
    description: 'Block all tool execution',
    icon: ShieldOff,
    color: 'red',
  },
  {
    mode: 'sandbox',
    label: 'Sandbox',
    description: 'Run in isolated Docker containers',
    icon: Container,
    color: 'blue',
  },
  {
    mode: 'allowlist',
    label: 'Allowlist',
    description: 'Only pre-approved commands',
    icon: ShieldCheck,
    color: 'green',
  },
  {
    mode: 'ask',
    label: 'Ask Always',
    description: 'Require approval for each tool',
    icon: ShieldQuestion,
    color: 'amber',
  },
  {
    mode: 'full',
    label: 'Full Access',
    description: 'No restrictions (dangerous!)',
    icon: Unlock,
    color: 'red',
  },
];

export function SecuritySection() {
  const queryClient = useQueryClient();
  const { authMode } = useAuth();
  const [newPattern, setNewPattern] = useState('');
  const [newType, setNewType] = useState<'command' | 'path' | 'url'>('command');
  const [newDescription, setNewDescription] = useState('');
  const [accessKeyInput, setAccessKeyInput] = useState('');
  const [showAccessKeyInput, setShowAccessKeyInput] = useState(false);

  const {
    data: securityData,
    refetch: refetchSecurity,
    isRefetching: isRefetchingSecurity,
  } = useQuery({
    queryKey: ['tools', 'security'],
    queryFn: async () => {
      const res = await fetch('/api/tools/security');
      if (!res.ok) throw new Error('Failed to fetch security policy');
      return res.json() as Promise<{
        policy: SecurityPolicy;
        allowlist: AllowlistEntry[];
      }>;
    },
    refetchInterval: 30000,
  });

  const {
    data: statusData,
    refetch: refetchStatus,
    isRefetching: isRefetchingStatus,
  } = useQuery({
    queryKey: ['tools', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/tools/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      return res.json() as Promise<{
        sandbox: SandboxStatus;
        pool: PoolStatus;
        rateLimit: RateLimitConfig;
      }>;
    },
    refetchInterval: 10000,
  });

  const updatePolicy = useMutation({
    mutationFn: async (updates: {
      mode?: SecurityMode;
      askTimeout?: number;
    }) => {
      const res = await fetch('/api/tools/security', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update policy');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools', 'security'] });
      toast.success('Security policy updated');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed'),
  });

  const addToAllowlist = useMutation({
    mutationFn: async (entry: {
      pattern: string;
      type: string;
      description?: string;
    }) => {
      const res = await fetch(
        '/api/tools/security/allowlist',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        },
      );
      if (!res.ok) throw new Error('Failed to add to allowlist');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools', 'security'] });
      setNewPattern('');
      setNewDescription('');
      toast.success('Added to allowlist');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed'),
  });

  const removeFromAllowlist = useMutation({
    mutationFn: async (pattern: string) => {
      const res = await fetch(
        `/api/tools/security/allowlist/${encodeURIComponent(pattern)}`,
        {
          method: 'DELETE',
        },
      );
      if (!res.ok) throw new Error('Failed to remove from allowlist');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools', 'security'] });
      toast.success('Removed from allowlist');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed'),
  });

  const updateRateLimit = useMutation({
    mutationFn: async (config: Partial<RateLimitConfig>) => {
      const res = await fetch(
        '/api/tools/ratelimit/config',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        },
      );
      if (!res.ok) throw new Error('Failed to update rate limits');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools', 'status'] });
      toast.success('Rate limits updated');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed'),
  });

  const policy = securityData?.policy;
  const allowlist = securityData?.allowlist || [];
  const sandbox = statusData?.sandbox;
  const pool = statusData?.pool;
  const rateLimit = statusData?.rateLimit;

  const getModeColors = (mode: SecurityMode, isActive: boolean) => {
    const config = SECURITY_MODES.find((m) => m.mode === mode);
    const color = config?.color || 'gray';
    if (!isActive) return 'border-border bg-muted/30 hover:bg-muted/50';
    switch (color) {
      case 'red':
        return 'border-red-500/50 bg-red-500/10 ring-2 ring-red-500/30';
      case 'blue':
        return 'border-blue-500/50 bg-blue-500/10 ring-2 ring-blue-500/30';
      case 'green':
        return 'border-green-500/50 bg-green-500/10 ring-2 ring-green-500/30';
      case 'amber':
        return 'border-amber-500/50 bg-amber-500/10 ring-2 ring-amber-500/30';
      default:
        return 'border-primary/50 bg-primary/10 ring-2 ring-primary/30';
    }
  };

  const getModeIconColor = (mode: SecurityMode) => {
    const config = SECURITY_MODES.find((m) => m.mode === mode);
    switch (config?.color) {
      case 'red':
        return 'text-red-500';
      case 'blue':
        return 'text-blue-500';
      case 'green':
        return 'text-green-500';
      case 'amber':
        return 'text-amber-500';
      default:
        return 'text-muted-foreground';
    }
  };

  // Access key management (local mode only)
  const { data: oobeData } = useQuery({
    queryKey: ['oobe', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/oobe/status');
      if (!res.ok) return { hasAccessKey: false };
      return res.json() as Promise<{ hasAccessKey?: boolean }>;
    },
    enabled: authMode === 'local',
  });

  const setAccessKey = useMutation({
    mutationFn: async (key: string | null) => {
      const res = await fetch('/api/auth/access-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update access key');
      }
      return res.json() as Promise<{ hasAccessKey: boolean }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['oobe', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      setAccessKeyInput('');
      toast.success(data.hasAccessKey ? 'Access key set' : 'Access key removed');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed'),
  });

  const handleSetAccessKey = () => {
    if (!accessKeyInput.trim()) {
      toast.error('Access key cannot be empty');
      return;
    }
    setAccessKey.mutate(accessKeyInput.trim());
  };

  const handleRemoveAccessKey = () => {
    setAccessKey.mutate(null);
  };

  const handleAddToAllowlist = () => {
    if (!newPattern.trim()) {
      toast.error('Pattern is required');
      return;
    }
    addToAllowlist.mutate({
      pattern: newPattern.trim(),
      type: newType,
      description: newDescription.trim() || undefined,
    });
  };

  return (
    <>
      {/* Access Key (local mode only) */}
      {authMode === 'local' && (
        <SettingsCard
          title="Access Key"
          description="Protect your instance with a passphrase when exposed publicly"
        >
          <div className="space-y-4">
            <div className={cn(
              'flex items-center gap-4 p-4 rounded-xl border',
              oobeData?.hasAccessKey
                ? 'bg-green-500/5 border-green-500/20'
                : 'bg-amber-500/5 border-amber-500/20',
            )}>
              <div className={cn(
                'h-12 w-12 rounded-xl flex items-center justify-center',
                oobeData?.hasAccessKey ? 'bg-green-500/10' : 'bg-amber-500/10',
              )}>
                <KeyRound className={cn(
                  'h-6 w-6',
                  oobeData?.hasAccessKey ? 'text-green-500' : 'text-amber-500',
                )} />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold">
                  {oobeData?.hasAccessKey ? 'Access key is set' : 'No access key set'}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {oobeData?.hasAccessKey
                    ? 'Visitors must enter the access key to use the dashboard'
                    : 'Anyone with the URL can access your dashboard'}
                </p>
              </div>
            </div>

            {/* Set/change access key */}
            <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {oobeData?.hasAccessKey ? 'Change Access Key' : 'Set Access Key'}
                </span>
              </div>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Input
                    type={showAccessKeyInput ? 'text' : 'password'}
                    placeholder="Enter a passphrase"
                    value={accessKeyInput}
                    onChange={(e) => setAccessKeyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSetAccessKey();
                    }}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccessKeyInput(!showAccessKeyInput)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showAccessKeyInput ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  onClick={handleSetAccessKey}
                  disabled={setAccessKey.isPending || !accessKeyInput.trim()}
                  className="rounded-xl"
                >
                  {setAccessKey.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Set Key'
                  )}
                </Button>
              </div>
              {oobeData?.hasAccessKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemoveAccessKey}
                  disabled={setAccessKey.isPending}
                  className="rounded-xl text-red-400 hover:text-red-500 hover:bg-red-500/10"
                >
                  Remove Access Key
                </Button>
              )}
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Security Mode Selector */}
      <SettingsCard
        title="Security Mode"
        description="Control how tool commands are validated and executed"
      >
        <div className="space-y-4">
          {/* Current Status Banner */}
          <div
            className={cn(
              'flex items-center gap-4 p-4 rounded-xl border',
              policy?.mode === 'full' || policy?.mode === 'deny'
                ? 'bg-red-500/5 border-red-500/20'
                : 'bg-green-500/5 border-green-500/20',
            )}
          >
            <div
              className={cn(
                'h-12 w-12 rounded-xl flex items-center justify-center',
                policy?.mode === 'full' || policy?.mode === 'deny'
                  ? 'bg-red-500/10'
                  : 'bg-green-500/10',
              )}
            >
              <Shield
                className={cn(
                  'h-6 w-6',
                  policy?.mode === 'full' || policy?.mode === 'deny'
                    ? 'text-red-500'
                    : 'text-green-500',
                )}
              />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold">
                Current Mode:{' '}
                {SECURITY_MODES.find((m) => m.mode === policy?.mode)?.label ||
                  'Unknown'}
              </h4>
              <p className="text-sm text-muted-foreground">
                {
                  SECURITY_MODES.find((m) => m.mode === policy?.mode)
                    ?.description
                }
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchSecurity()}
              disabled={isRefetchingSecurity}
              className="rounded-xl"
            >
              <RefreshCw
                className={cn(
                  'h-4 w-4 mr-2',
                  isRefetchingSecurity && 'animate-spin',
                )}
              />
              Refresh
            </Button>
          </div>

          {/* Mode Options */}
          <div className="grid gap-3">
            {SECURITY_MODES.map((config) => {
              const isActive = policy?.mode === config.mode;
              const Icon = config.icon;
              return (
                <button
                  key={config.mode}
                  onClick={() => updatePolicy.mutate({ mode: config.mode })}
                  disabled={updatePolicy.isPending}
                  className={cn(
                    'flex items-center gap-4 p-4 rounded-xl border transition-all text-left',
                    getModeColors(config.mode, isActive),
                  )}
                >
                  <div
                    className={cn(
                      'h-10 w-10 rounded-xl flex items-center justify-center',
                      isActive ? 'bg-white/10' : 'bg-muted/50',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5',
                        isActive
                          ? getModeIconColor(config.mode)
                          : 'text-muted-foreground',
                      )}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{config.label}</h4>
                      {isActive && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                          Active
                        </span>
                      )}
                      {config.mode === 'full' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                          Dangerous
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {config.description}
                    </p>
                  </div>
                  {isActive && (
                    <CheckCircle2
                      className={cn('h-5 w-5', getModeIconColor(config.mode))}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Ask Mode Timeout */}
          {policy?.mode === 'ask' && (
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border">
              <div>
                <p className="text-sm font-medium">Approval Timeout</p>
                <p className="text-xs text-muted-foreground">
                  How long to wait for user approval
                </p>
              </div>
              <select
                value={policy?.askTimeout || 30000}
                onChange={(e) =>
                  updatePolicy.mutate({ askTimeout: parseInt(e.target.value) })
                }
                className="field py-1.5"
              >
                <option value={15000}>15 seconds</option>
                <option value={30000}>30 seconds</option>
                <option value={60000}>1 minute</option>
                <option value={120000}>2 minutes</option>
                <option value={300000}>5 minutes</option>
              </select>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Allowlist Management */}
      <SettingsCard
        title="Allowlist"
        description="Pre-approved patterns for commands, paths, and URLs"
      >
        <div className="space-y-4">
          {/* Add New Entry */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Add New Pattern</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <select
                value={newType}
                onChange={(e) =>
                  setNewType(e.target.value as 'command' | 'path' | 'url')
                }
                className="field"
              >
                <option value="command">Command</option>
                <option value="path">File Path</option>
                <option value="url">URL</option>
              </select>
              <input
                type="text"
                placeholder={
                  newType === 'command'
                    ? 'git *'
                    : newType === 'path'
                      ? '/workspace/**'
                      : 'https://api.*'
                }
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                className="col-span-2 field"
              />
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Description (optional)"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="flex-1 field"
              />
              <Button
                onClick={handleAddToAllowlist}
                disabled={addToAllowlist.isPending || !newPattern.trim()}
                className="rounded-xl"
              >
                {addToAllowlist.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Allowlist Entries */}
          {allowlist.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No patterns in allowlist</p>
              <p className="text-xs">
                Add patterns to allow specific commands, paths, or URLs
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allowlist.map((entry, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border group"
                >
                  <div
                    className={cn(
                      'h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold',
                      entry.type === 'command'
                        ? 'bg-indigo-500/10 text-indigo-500'
                        : entry.type === 'path'
                          ? 'bg-blue-500/10 text-blue-500'
                          : 'bg-green-500/10 text-green-500',
                    )}
                  >
                    {entry.type === 'command' ? (
                      <Terminal className="h-4 w-4" />
                    ) : entry.type === 'path' ? (
                      <FileCode className="h-4 w-4" />
                    ) : (
                      <Globe className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <code className="text-sm font-mono">{entry.pattern}</code>
                    {entry.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {entry.description}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase">
                    {entry.type}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFromAllowlist.mutate(entry.pattern)}
                    disabled={removeFromAllowlist.isPending}
                    className="opacity-0 group-hover:opacity-100 h-8 w-8 p-0 text-red-400 hover:text-red-500 hover:bg-red-500/10"
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Execution Status */}
      <SettingsCard
        title="Execution Status"
        description="Real-time tool execution monitoring"
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Sandbox Status */}
          <div
            className={cn(
              'p-4 rounded-xl border',
              sandbox?.available
                ? 'bg-green-500/5 border-green-500/20'
                : 'bg-muted/30 border-border',
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <Container
                className={cn(
                  'h-4 w-4',
                  sandbox?.available
                    ? 'text-green-500'
                    : 'text-muted-foreground',
                )}
              />
              <span className="text-xs font-medium">Sandbox</span>
            </div>
            <p
              className={cn(
                'text-2xl font-bold',
                sandbox?.available ? 'text-green-500' : 'text-muted-foreground',
              )}
            >
              {sandbox?.available ? 'Ready' : 'Unavailable'}
            </p>
            {sandbox?.available ? (
              <p className="text-xs text-muted-foreground mt-1">
                {sandbox.activeContainers}/{sandbox.poolSize} containers
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                Docker required
              </p>
            )}
          </div>

          {/* Running Tasks */}
          <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-medium">Running</span>
            </div>
            <p className="text-2xl font-bold text-blue-500">
              {pool?.running || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              of {pool?.maxConcurrent || 10} max
            </p>
          </div>

          {/* Queued Tasks */}
          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium">Queued</span>
            </div>
            <p className="text-2xl font-bold text-amber-500">
              {pool?.queued || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              of {pool?.maxQueueSize || 100} max
            </p>
          </div>

          {/* Rate Limits */}
          <div
            className={cn(
              'p-4 rounded-xl border',
              rateLimit?.enabled
                ? 'bg-indigo-500/5 border-indigo-500/20'
                : 'bg-muted/30 border-border',
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <Timer className="h-4 w-4 text-indigo-500" />
              <span className="text-xs font-medium">Rate Limit</span>
            </div>
            <p
              className={cn(
                'text-2xl font-bold',
                rateLimit?.enabled
                  ? 'text-indigo-500'
                  : 'text-muted-foreground',
              )}
            >
              {rateLimit?.enabled ? 'Active' : 'Disabled'}
            </p>
            {rateLimit?.enabled && (
              <p className="text-xs text-muted-foreground mt-1">
                {rateLimit.globalLimit}/min global
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchStatus()}
            disabled={isRefetchingStatus}
            className="rounded-xl"
          >
            <RefreshCw
              className={cn(
                'h-4 w-4 mr-2',
                isRefetchingStatus && 'animate-spin',
              )}
            />
            Refresh Status
          </Button>
        </div>
      </SettingsCard>

      {/* Rate Limit Configuration */}
      <SettingsCard
        title="Rate Limits"
        description="Configure execution rate limits to prevent abuse"
      >
        <div className="space-y-4">
          <ToggleOption
            label="Enable Rate Limiting"
            description="Enforce limits on tool execution frequency"
            checked={rateLimit?.enabled ?? true}
            onChange={() =>
              updateRateLimit.mutate({ enabled: !rateLimit?.enabled })
            }
            disabled={updateRateLimit.isPending}
          />

          {rateLimit?.enabled && (
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Per User
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={rateLimit?.userLimit || 100}
                    onChange={(e) =>
                      updateRateLimit.mutate({
                        userLimit: parseInt(e.target.value) || 100,
                      })
                    }
                    className="w-full field"
                    min={1}
                    max={1000}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    /min
                  </span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Per Conversation
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={rateLimit?.conversationLimit || 50}
                    onChange={(e) =>
                      updateRateLimit.mutate({
                        conversationLimit: parseInt(e.target.value) || 50,
                      })
                    }
                    className="w-full field"
                    min={1}
                    max={500}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    /min
                  </span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Global Limit
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={rateLimit?.globalLimit || 500}
                    onChange={(e) =>
                      updateRateLimit.mutate({
                        globalLimit: parseInt(e.target.value) || 500,
                      })
                    }
                    className="w-full field"
                    min={1}
                    max={5000}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    /min
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Security Info */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
            <ShieldAlert className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <h4 className="font-semibold mb-1">Security Best Practices</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>
                Use <strong>Sandbox</strong> mode for production environments
                to isolate tool execution
              </li>
              <li>
                Configure the <strong>Allowlist</strong> to restrict which
                commands can run without approval
              </li>
              <li>
                Enable <strong>Rate Limiting</strong> to prevent abuse and
                runaway processes
              </li>
              <li>
                Avoid <strong>Full Access</strong> mode unless absolutely
                necessary for development
              </li>
              <li>
                Regularly review the <strong>Audit Log</strong> for suspicious
                activity
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
