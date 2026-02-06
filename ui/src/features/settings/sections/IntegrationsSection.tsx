/**
 * Integrations Section
 *
 * Manages external service integrations (GitHub, Jira, Linear).
 * Uses OAuth with scope upgrade for seamless authentication.
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Github,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Key,
  Shield,
  Loader2,
  Eye,
  EyeOff,
  Unlink,
  ChevronDown,
  Search,
  Globe,
  FlaskConical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SettingsCard } from '../components';
import { API_BASE } from '../constants';

interface GitHubIntegrationStatus {
  connected: boolean;
  source: 'oauth' | 'pat' | null;
  username: string | null;
  scopes: string[];
  missingScopes: string[];
  hasSyncPermissions: boolean;
  connectedAt: string | null;
  requiredScopes: {
    login: string[];
    sync: string[];
    webhooks: string[];
  };
}

interface WebSearchConfig {
  enabled: boolean;
  provider: 'brave' | 'serper' | 'searxng' | 'tavily';
  brave?: { apiKey?: string };
  serper?: { apiKey?: string };
  searxng?: { baseUrl?: string; apiKey?: string };
  tavily?: { apiKey?: string };
}

interface WebSearchStatus {
  config: WebSearchConfig;
  status: {
    available: boolean;
    provider?: string;
    reason?: string;
  };
  providers: Array<{
    id: string;
    name: string;
    description: string;
    configFields: string[];
  }>;
}

interface IntegrationsSectionProps {
  settings: {
    integrations?: {
      githubToken?: string;
      ollamaEndpoint?: string;
      openclawApiKey?: string;
    };
    webSearch?: WebSearchConfig;
  };
  onUpdate: (category: string, key: string, value: unknown) => void;
}

// Scope descriptions for user understanding
const SCOPE_INFO: Record<string, { name: string; description: string; feature: string }> = {
  'read:user': { name: 'Read User', description: 'Access your GitHub profile info', feature: 'Login' },
  'user:email': { name: 'User Email', description: 'Read your email address', feature: 'Login' },
  'repo': { name: 'Repository Access', description: 'Read/write access to repositories', feature: 'Sync' },
  'read:project': { name: 'Read Projects', description: 'View GitHub Projects boards', feature: 'Sync' },
  'admin:repo_hook': { name: 'Webhooks', description: 'Create webhooks for real-time updates', feature: 'Webhooks' },
  'workflow': { name: 'Workflows', description: 'Manage GitHub Actions workflows', feature: 'CI/CD' },
};

// Scope details component
function ScopeDetails({
  scopes,
  requiredScopes
}: {
  scopes: string[];
  requiredScopes?: { login: string[]; sync: string[]; webhooks: string[] };
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!requiredScopes) return null;

  const allRequired = [...requiredScopes.login, ...requiredScopes.sync];
  const optional = requiredScopes.webhooks;

  return (
    <div className="mt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
        View permissions ({scopes.length} granted)
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-3 p-3 rounded-lg bg-muted/30 border border-border/50">
          {/* Required Permissions */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Required for Sync
            </p>
            <div className="space-y-1.5">
              {allRequired.map((scope) => {
                const hasScope = scopes.includes(scope);
                const info = SCOPE_INFO[scope];
                return (
                  <div key={scope} className="flex items-center gap-2">
                    {hasScope ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                    )}
                    <code className="text-[10px] px-1 py-0.5 bg-muted rounded">{scope}</code>
                    {info && (
                      <span className="text-[10px] text-muted-foreground">
                        — {info.description}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Optional Permissions */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Optional (Webhooks)
            </p>
            <div className="space-y-1.5">
              {optional.map((scope) => {
                const hasScope = scopes.includes(scope);
                const info = SCOPE_INFO[scope];
                return (
                  <div key={scope} className="flex items-center gap-2">
                    {hasScope ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                    )}
                    <code className="text-[10px] px-1 py-0.5 bg-muted rounded">{scope}</code>
                    {info && (
                      <span className="text-[10px] text-muted-foreground">
                        — {info.description}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Additional granted scopes */}
          {scopes.filter(s => !allRequired.includes(s) && !optional.includes(s)).length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Additional Permissions
              </p>
              <div className="flex flex-wrap gap-1">
                {scopes
                  .filter(s => !allRequired.includes(s) && !optional.includes(s))
                  .map((scope) => (
                    <code key={scope} className="text-[10px] px-1.5 py-0.5 bg-muted rounded">
                      {scope}
                    </code>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Mask sensitive values for display
function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 4) + '••••••••••••' + value.slice(-4);
}

// Web Search Provider Info
const WEB_SEARCH_PROVIDERS = {
  brave: {
    name: 'Brave Search',
    description: 'Fast, privacy-focused search',
    icon: Shield,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    helpUrl: 'https://brave.com/search/api/',
    fields: ['apiKey'],
  },
  serper: {
    name: 'Serper (Google)',
    description: 'Google Search results via API',
    icon: Search,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    helpUrl: 'https://serper.dev/',
    fields: ['apiKey'],
  },
  searxng: {
    name: 'SearXNG',
    description: 'Self-hosted metasearch engine',
    icon: Globe,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    helpUrl: 'https://docs.searxng.org/',
    fields: ['baseUrl', 'apiKey'],
  },
  tavily: {
    name: 'Tavily',
    description: 'AI-optimized search API',
    icon: FlaskConical,
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-500/10',
    helpUrl: 'https://tavily.com/',
    fields: ['apiKey'],
  },
} as const;

export function IntegrationsSection({ settings, onUpdate }: IntegrationsSectionProps) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showPat, setShowPat] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [showWebSearchKey, setShowWebSearchKey] = useState(false);

  // Check for success/error from OAuth callback
  useEffect(() => {
    const githubStatus = searchParams.get('github');
    const error = searchParams.get('error');

    if (githubStatus === 'connected') {
      toast.success('GitHub connected successfully!', {
        description: 'Your GitHub account is now linked for sync.',
      });
      // Clear the query params
      setSearchParams({});
      // Refresh the status
      queryClient.invalidateQueries({ queryKey: ['github-integration-status'] });
    }

    if (error) {
      toast.error('GitHub connection failed', {
        description: error === 'no_code' ? 'No authorization code received' :
                     error === 'invalid_state' ? 'Security validation failed. Please try again.' :
                     decodeURIComponent(error),
      });
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, queryClient]);

  // Fetch GitHub integration status
  const { data: githubStatus, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery<GitHubIntegrationStatus>({
    queryKey: ['github-integration-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/auth/github/status`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch GitHub status');
      return res.json();
    },
    staleTime: 30000, // 30 seconds
  });

  // Connect/upgrade GitHub OAuth
  const connectGitHubMutation = useMutation({
    mutationFn: async (isUpgrade: boolean) => {
      const endpoint = isUpgrade ? `${API_BASE}/api/auth/github/upgrade-url` : `${API_BASE}/api/auth/github/url`;
      const res = await fetch(endpoint, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to get GitHub auth URL');
      const data = await res.json();
      return data.url;
    },
    onSuccess: (url: string) => {
      window.location.href = url;
    },
    onError: (error) => {
      toast.error('Failed to connect GitHub', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Save PAT mutation
  const savePatMutation = useMutation({
    mutationFn: async (token: string) => {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          integrations: { githubToken: token },
        }),
      });
      if (!res.ok) throw new Error('Failed to save token');
      return res.json();
    },
    onSuccess: () => {
      toast.success('GitHub token saved');
      setPatInput('');
      queryClient.invalidateQueries({ queryKey: ['github-integration-status'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => {
      toast.error('Failed to save token', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Fetch Web Search config
  const { data: webSearchStatus } = useQuery<WebSearchStatus>({
    queryKey: ['web-search-config'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/integrations/web-search`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch web search config');
      return res.json();
    },
    staleTime: 30000,
  });

  // Update Web Search config
  const updateWebSearchMutation = useMutation({
    mutationFn: async (config: Partial<WebSearchConfig>) => {
      const res = await fetch(`${API_BASE}/api/integrations/web-search`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Failed to update web search config');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Web search configuration updated');
      queryClient.invalidateQueries({ queryKey: ['web-search-config'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => {
      toast.error('Failed to update web search', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Test Web Search
  const testWebSearchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/integrations/web-search/test`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Test failed');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Web search test passed!', {
          description: `Found ${data.resultCount} results via ${data.provider}`,
        });
      } else {
        toast.error('Web search test failed', {
          description: data.error,
        });
      }
    },
    onError: (error) => {
      toast.error('Web search test failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const handleConnectGitHub = () => {
    connectGitHubMutation.mutate(false);
  };

  const handleUpgradeScopes = () => {
    connectGitHubMutation.mutate(true);
  };

  const handleSavePat = () => {
    if (!patInput.trim()) return;
    savePatMutation.mutate(patInput.trim());
  };

  const handleWebSearchToggle = (enabled: boolean) => {
    updateWebSearchMutation.mutate({ enabled });
  };

  const handleWebSearchProviderChange = (provider: WebSearchConfig['provider']) => {
    updateWebSearchMutation.mutate({ provider });
  };

  const handleWebSearchApiKeyChange = (provider: WebSearchConfig['provider'], apiKey: string) => {
    const update: Partial<WebSearchConfig> = {};
    if (provider === 'brave') update.brave = { apiKey };
    else if (provider === 'serper') update.serper = { apiKey };
    else if (provider === 'tavily') update.tavily = { apiKey };
    else if (provider === 'searxng') update.searxng = { ...webSearchStatus?.config.searxng, apiKey };
    updateWebSearchMutation.mutate(update);
  };

  const handleSearxngUrlChange = (baseUrl: string) => {
    updateWebSearchMutation.mutate({
      searxng: { ...webSearchStatus?.config.searxng, baseUrl },
    });
  };

  const existingPat = settings.integrations?.githubToken;

  return (
    <>
      <SettingsCard
        title="GitHub Integration"
        description="Connect your GitHub account for projects, issues, and sync"
      >
        <div className="space-y-6">
          {/* Connection Status */}
          <div className="flex items-start gap-4">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              githubStatus?.connected ? 'bg-green-500/10' : 'bg-muted'
            )}>
              <Github className={cn(
                'h-6 w-6',
                githubStatus?.connected ? 'text-green-500' : 'text-muted-foreground'
              )} />
            </div>

            <div className="flex-1 min-w-0">
              {isLoadingStatus ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking connection...</span>
                </div>
              ) : githubStatus?.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="font-medium">
                      Connected as @{githubStatus.username}
                    </span>
                    <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                      via {githubStatus.source === 'oauth' ? 'OAuth' : 'Personal Token'}
                    </span>
                  </div>

                  {/* Scope Status */}
                  {githubStatus.hasSyncPermissions ? (
                    <div className="flex items-center gap-2 mt-1">
                      <Shield className="h-3.5 w-3.5 text-green-500" />
                      <span className="text-xs text-green-600 dark:text-green-400">
                        Full sync permissions enabled
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 mt-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
                        <span className="text-xs text-yellow-600 dark:text-yellow-400">
                          Missing permissions for sync: {githubStatus.missingScopes.join(', ')}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleUpgradeScopes}
                        disabled={connectGitHubMutation.isPending}
                        className="w-fit"
                      >
                        {connectGitHubMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Redirecting...
                          </>
                        ) : (
                          <>
                            <Shield className="h-4 w-4 mr-2" />
                            Enable Sync Permissions
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  {/* Permissions Detail */}
                  <ScopeDetails
                    scopes={githubStatus.scopes}
                    requiredScopes={githubStatus.requiredScopes}
                  />

                  {/* Connected timestamp */}
                  {githubStatus.connectedAt && (
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Connected {new Date(githubStatus.connectedAt).toLocaleDateString()}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Not connected</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sign in with GitHub to enable project sync and issue tracking
                  </p>
                  <Button
                    size="sm"
                    onClick={handleConnectGitHub}
                    disabled={connectGitHubMutation.isPending}
                    className="mt-3"
                  >
                    {connectGitHubMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Redirecting...
                      </>
                    ) : (
                      <>
                        <Github className="h-4 w-4 mr-2" />
                        Connect GitHub
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchStatus()}
              disabled={isLoadingStatus}
              className="h-8 w-8 p-0"
              title="Refresh status"
            >
              <RefreshCw className={cn('h-4 w-4', isLoadingStatus && 'animate-spin')} />
            </Button>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">or use a personal access token</span>
            </div>
          </div>

          {/* Personal Access Token (Alternative) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Personal Access Token</p>
                <p className="text-xs text-muted-foreground">
                  For CLI tools or fine-grained permissions
                </p>
              </div>
              <a
                href="https://github.com/settings/tokens/new?scopes=repo,read:project"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Create token
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {existingPat ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 bg-muted rounded-lg font-mono text-sm">
                  {maskValue(existingPat)}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onUpdate('integrations', 'githubToken', '');
                    toast.success('Token removed');
                    queryClient.invalidateQueries({ queryKey: ['github-integration-status'] });
                  }}
                  className="h-9"
                >
                  <Unlink className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showPat ? 'text' : 'password'}
                    value={patInput}
                    onChange={(e) => setPatInput(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    className="w-full px-3 py-2 pr-10 bg-muted rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPat(!showPat)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPat ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  size="sm"
                  onClick={handleSavePat}
                  disabled={!patInput.trim() || savePatMutation.isPending}
                  className="h-9"
                >
                  {savePatMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Key className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Requires <code className="px-1 py-0.5 bg-muted rounded">repo</code> and{' '}
              <code className="px-1 py-0.5 bg-muted rounded">read:project</code> scopes
            </p>
          </div>
        </div>
      </SettingsCard>

      {/* Other Integrations Placeholder */}
      <SettingsCard
        title="Other Services"
        description="Additional integrations (coming soon)"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Jira */}
          <div className="p-4 rounded-xl border border-dashed border-border bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <span className="text-lg font-bold text-blue-500">J</span>
              </div>
              <div>
                <p className="font-medium text-sm">Jira</p>
                <p className="text-xs text-muted-foreground">Coming soon</p>
              </div>
            </div>
          </div>

          {/* Linear */}
          <div className="p-4 rounded-xl border border-dashed border-border bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <span className="text-lg font-bold text-indigo-500">L</span>
              </div>
              <div>
                <p className="font-medium text-sm">Linear</p>
                <p className="text-xs text-muted-foreground">Coming soon</p>
              </div>
            </div>
          </div>
        </div>
      </SettingsCard>

      {/* Web Search Section */}
      <SettingsCard
        title="Web Search"
        description="Enable AI agents to search the web for up-to-date information"
      >
        <div className="space-y-6">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                'h-10 w-10 rounded-lg flex items-center justify-center',
                webSearchStatus?.status.available ? 'bg-green-500/10' : 'bg-muted'
              )}>
                <Search className={cn(
                  'h-5 w-5',
                  webSearchStatus?.status.available ? 'text-green-500' : 'text-muted-foreground'
                )} />
              </div>
              <div>
                <p className="font-medium text-sm">Enable Web Search</p>
                <p className="text-xs text-muted-foreground">
                  {webSearchStatus?.status.available
                    ? `Active via ${webSearchStatus.status.provider}`
                    : webSearchStatus?.status.reason || 'Configure a provider below'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {webSearchStatus?.config.enabled && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testWebSearchMutation.mutate()}
                  disabled={testWebSearchMutation.isPending || !webSearchStatus?.status.available}
                >
                  {testWebSearchMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Test'
                  )}
                </Button>
              )}
              <button
                role="switch"
                aria-checked={webSearchStatus?.config.enabled ?? false}
                onClick={() => handleWebSearchToggle(!webSearchStatus?.config.enabled)}
                disabled={updateWebSearchMutation.isPending}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2',
                  webSearchStatus?.config.enabled ? 'bg-primary' : 'bg-muted'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    webSearchStatus?.config.enabled ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Provider Selection */}
          {webSearchStatus?.config.enabled && (
            <>
              <div className="space-y-3">
                <label className="text-sm font-medium">Search Provider</label>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(WEB_SEARCH_PROVIDERS).map(([id, provider]) => {
                    const isSelected = webSearchStatus?.config.provider === id;
                    const Icon = provider.icon;
                    return (
                      <button
                        key={id}
                        onClick={() => handleWebSearchProviderChange(id as WebSearchConfig['provider'])}
                        className={cn(
                          'p-3 rounded-lg border text-left transition-all',
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center', provider.bgColor)}>
                            <Icon className={cn('h-4 w-4', provider.color)} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{provider.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{provider.description}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Provider-specific Configuration */}
              {webSearchStatus?.config.provider && (
                <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {WEB_SEARCH_PROVIDERS[webSearchStatus.config.provider].name} Configuration
                    </p>
                    <a
                      href={WEB_SEARCH_PROVIDERS[webSearchStatus.config.provider].helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      Get API Key
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  {/* SearXNG URL (only for searxng provider) */}
                  {webSearchStatus.config.provider === 'searxng' && (
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Instance URL</label>
                      <input
                        type="text"
                        value={webSearchStatus.config.searxng?.baseUrl || ''}
                        onChange={(e) => handleSearxngUrlChange(e.target.value)}
                        placeholder="https://searxng.example.com"
                        className="w-full px-3 py-2 bg-background rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                  )}

                  {/* API Key Input */}
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      API Key {webSearchStatus.config.provider === 'searxng' && '(optional)'}
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showWebSearchKey ? 'text' : 'password'}
                          value={(() => {
                            const p = webSearchStatus.config.provider;
                            if (p === 'brave') return webSearchStatus.config.brave?.apiKey || '';
                            if (p === 'serper') return webSearchStatus.config.serper?.apiKey || '';
                            if (p === 'tavily') return webSearchStatus.config.tavily?.apiKey || '';
                            if (p === 'searxng') return webSearchStatus.config.searxng?.apiKey || '';
                            return '';
                          })()}
                          onChange={(e) => handleWebSearchApiKeyChange(webSearchStatus.config.provider, e.target.value)}
                          placeholder={webSearchStatus.config.provider === 'searxng' ? 'Optional auth key' : 'Enter API key'}
                          className="w-full px-3 py-2 pr-10 bg-background rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        <button
                          type="button"
                          onClick={() => setShowWebSearchKey(!showWebSearchKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showWebSearchKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {updateWebSearchMutation.isPending && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving...
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </SettingsCard>

      {/* API Keys Section */}
      <SettingsCard
        title="AI Services"
        description="Configure connections to AI providers"
      >
        <div className="space-y-4">
          {/* OpenClaw API Key */}
          <div className="space-y-2">
            <label className="text-sm font-medium">OpenClaw API Key</label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={settings.integrations?.openclawApiKey || ''}
                onChange={(e) => onUpdate('integrations', 'openclawApiKey', e.target.value)}
                placeholder="sk-oc-..."
                className="flex-1 px-3 py-2 bg-muted rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              For autonomous AI agent workflows
            </p>
          </div>

          {/* Ollama Endpoint */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Ollama Endpoint</label>
            <input
              type="text"
              value={settings.integrations?.ollamaEndpoint || ''}
              onChange={(e) => onUpdate('integrations', 'ollamaEndpoint', e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full px-3 py-2 bg-muted rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-[10px] text-muted-foreground">
              Local Ollama instance URL
            </p>
          </div>
        </div>
      </SettingsCard>
    </>
  );
}
