/**
 * Messaging Section
 *
 * Configure messaging integrations:
 * - Telegram Bot
 * - Discord Bot
 * - WhatsApp Business
 * - Slack (links to existing integration)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  Send,
  Link2,
  Unlink,
  ShieldCheck,
  Info,
  Copy,
  Cloud,
  Bot,
  Users,
  MessageSquare,
  Gauge,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SettingsCard } from '../components';
import { API_BASE } from '../constants';
import {
  TelegramLogo,
  DiscordLogo,
  WhatsAppLogo,
  SlackLogo,
  MatrixLogo,
  GoogleChatLogo,
  TeamsLogo,
} from '@/components/shared/ProviderLogos';

// =============================================================================
// TYPES
// =============================================================================

type MessagingProvider = 'telegram' | 'discord' | 'whatsapp' | 'slack' | 'matrix' | 'googlechat' | 'msteams';

interface ProviderInfo {
  id: MessagingProvider;
  name: string;
  description: string;
  Logo: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  activeBorder: string;
  activeBg: string;
  docsUrl: string;
  setupUrl: string;
  status: 'available' | 'coming-soon' | 'external';
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Bot API with commands & inline keyboards',
    Logo: TelegramLogo,
    color: 'text-[#0088CC]',
    bgColor: 'bg-[#0088CC]/10',
    activeBorder: 'border-[#0088CC]/40',
    activeBg: 'bg-[#0088CC]/8',
    docsUrl: 'https://core.telegram.org/bots/api',
    setupUrl: 'https://t.me/BotFather',
    status: 'available',
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Slash commands & interactions',
    Logo: DiscordLogo,
    color: 'text-[#5865F2]',
    bgColor: 'bg-[#5865F2]/10',
    activeBorder: 'border-[#5865F2]/40',
    activeBg: 'bg-[#5865F2]/8',
    docsUrl: 'https://discord.com/developers/docs',
    setupUrl: 'https://discord.com/developers/applications',
    status: 'available',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Business Cloud API',
    Logo: WhatsAppLogo,
    color: 'text-[#25D366]',
    bgColor: 'bg-[#25D366]/10',
    activeBorder: 'border-[#25D366]/40',
    activeBg: 'bg-[#25D366]/8',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp',
    setupUrl: 'https://developers.facebook.com/apps/',
    status: 'available',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Bolt SDK with slash commands',
    Logo: SlackLogo,
    color: 'text-[#4A154B]',
    bgColor: 'bg-[#4A154B]/10',
    activeBorder: 'border-[#4A154B]/40',
    activeBg: 'bg-[#4A154B]/8',
    docsUrl: 'https://api.slack.com/',
    setupUrl: 'https://api.slack.com/apps',
    status: 'available',
  },
  {
    id: 'matrix',
    name: 'Matrix',
    description: 'Decentralized, E2EE optional',
    Logo: MatrixLogo,
    color: 'text-[#0DBD8B]',
    bgColor: 'bg-[#0DBD8B]/10',
    activeBorder: 'border-[#0DBD8B]/40',
    activeBg: 'bg-[#0DBD8B]/8',
    docsUrl: 'https://spec.matrix.org/',
    setupUrl: 'https://element.io/',
    status: 'available',
  },
  {
    id: 'googlechat',
    name: 'Google Chat',
    description: 'Workspace integration',
    Logo: GoogleChatLogo,
    color: 'text-[#00AC47]',
    bgColor: 'bg-[#00AC47]/10',
    activeBorder: 'border-[#00AC47]/40',
    activeBg: 'bg-[#00AC47]/8',
    docsUrl: 'https://developers.google.com/chat',
    setupUrl: 'https://console.cloud.google.com/',
    status: 'available',
  },
  {
    id: 'msteams',
    name: 'MS Teams',
    description: 'Bot Framework + Adaptive Cards',
    Logo: TeamsLogo,
    color: 'text-[#5059C9]',
    bgColor: 'bg-[#5059C9]/10',
    activeBorder: 'border-[#5059C9]/40',
    activeBg: 'bg-[#5059C9]/8',
    docsUrl: 'https://learn.microsoft.com/en-us/microsoftteams/platform/',
    setupUrl: 'https://dev.teams.microsoft.com/',
    status: 'available',
  },
];

interface TelegramStatus {
  configured: boolean;
  connected: boolean;
  latencyMs?: number;
  error?: string;
  bot?: {
    id: number;
    username: string;
    name: string;
  };
  allowlists?: {
    users: number;
    chats: number;
  };
}

interface WebhookInfo {
  url: string | null;
  pendingUpdateCount: number;
  hasCustomCertificate: boolean;
  lastError?: {
    date: number;
    message: string;
  } | null;
}

interface WhatsAppStatus {
  configured: boolean;
  connected: boolean;
  latencyMs?: number;
  error?: string;
  phone?: {
    verifiedName: string;
    displayPhoneNumber: string;
    qualityRating: string;
  };
  allowlist?: {
    phones: number;
  };
}

interface DiscordStatus {
  configured: boolean;
  connected: boolean;
  latencyMs?: number;
  error?: string;
  bot?: {
    id: string;
    username: string;
    discriminator: string;
    verified: boolean;
  };
  allowlists?: {
    guilds: number;
    channels: number;
    roles: number;
  };
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function MessagingSection() {
  const [activeProvider, setActiveProvider] = useState<MessagingProvider>('telegram');

  return (
    <div className="space-y-6">
      {/* Provider Tabs */}
      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((provider) => {
          const Logo = provider.Logo;
          const isActive = activeProvider === provider.id;
          const isExternal = provider.status === 'external';
          const isComingSoon = provider.status === 'coming-soon';

          return (
            <button
              key={provider.id}
              onClick={() => setActiveProvider(provider.id)}
              className={cn(
                'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all',
                isActive
                  ? `${provider.activeBorder} ${provider.activeBg} shadow-sm`
                  : 'border-border hover:border-primary/30 hover:bg-muted/50',
                isComingSoon && !isActive && 'opacity-80'
              )}
            >
              <div className={cn(
                'h-8 w-8 rounded-lg flex items-center justify-center transition-all',
                isActive ? provider.bgColor : 'bg-muted'
              )}>
                <Logo className={cn('h-4 w-4', isActive ? provider.color : 'text-muted-foreground')} />
              </div>
              <div className="text-left">
                <p className={cn('font-medium text-sm', isActive && provider.color)}>{provider.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {isComingSoon ? 'Coming soon' : isExternal ? 'See Integrations' : isActive ? 'Active' : 'Configure'}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Provider Content */}
      {activeProvider === 'telegram' && <TelegramConfig />}
      {activeProvider === 'discord' && <DiscordConfig />}
      {activeProvider === 'whatsapp' && <WhatsAppConfig />}
      {activeProvider === 'slack' && <SlackConfig />}
      {activeProvider === 'matrix' && <MatrixConfig />}
      {activeProvider === 'googlechat' && <GoogleChatConfig />}
      {activeProvider === 'msteams' && <TeamsConfig />}

      {/* Group Chat Configuration */}
      <GroupChatConfig />
    </div>
  );
}

// =============================================================================
// TELEGRAM CONFIG
// =============================================================================

function TelegramConfig() {
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [testChatId, setTestChatId] = useState('');
  const [testMessage, setTestMessage] = useState('Hello from profClaw!');

  // Fetch Telegram status
  const { data: status, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery<TelegramStatus>({
    queryKey: ['telegram-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/telegram/status`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch Telegram status');
      return res.json();
    },
    staleTime: 30000,
  });

  // Fetch webhook info
  const { data: webhookInfo, refetch: refetchWebhook } = useQuery<WebhookInfo>({
    queryKey: ['telegram-webhook'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/telegram/webhook`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch webhook info');
      return res.json();
    },
    staleTime: 30000,
    enabled: !!status?.configured,
  });

  // Save config mutation
  const saveConfigMutation = useMutation({
    mutationFn: async (botToken: string) => {
      const res = await fetch(`${API_BASE}/api/telegram/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ botToken }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save config');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success('Telegram bot configured!', {
        description: `Connected as @${data.account.botUsername}`,
      });
      setTokenInput('');
      if (data.webhookSecret) {
        navigator.clipboard.writeText(data.webhookSecret);
        toast.info('Webhook secret copied to clipboard');
      }
      queryClient.invalidateQueries({ queryKey: ['telegram-status'] });
    },
    onError: (error) => {
      toast.error('Failed to configure Telegram', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Set webhook mutation
  const setWebhookMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch(`${API_BASE}/api/telegram/set-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to set webhook');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success('Webhook configured!');
      setWebhookUrl('');
      if (data.secretToken) {
        navigator.clipboard.writeText(data.secretToken);
        toast.info('Secret token copied to clipboard');
      }
      queryClient.invalidateQueries({ queryKey: ['telegram-webhook'] });
    },
    onError: (error) => {
      toast.error('Failed to set webhook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Delete webhook mutation
  const deleteWebhookMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/telegram/webhook`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete webhook');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Webhook removed');
      queryClient.invalidateQueries({ queryKey: ['telegram-webhook'] });
    },
    onError: (error) => {
      toast.error('Failed to remove webhook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Test message mutation
  const testMessageMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/telegram/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ chat_id: testChatId, text: testMessage }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to send message');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Test message sent!');
    },
    onError: (error) => {
      toast.error('Failed to send message', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Disconnect bot mutation
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/telegram/config`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to disconnect');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Telegram bot disconnected');
      setTokenInput('');
      setWebhookUrl('');
      queryClient.invalidateQueries({ queryKey: ['telegram-status'] });
      queryClient.invalidateQueries({ queryKey: ['telegram-webhook'] });
    },
    onError: (error) => {
      toast.error('Failed to disconnect', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const handleRefreshAll = () => {
    refetchStatus();
    refetchWebhook();
  };

  return (
    <>
      {/* Telegram Hero Banner */}
      <div className="relative overflow-hidden rounded-xl border border-[#0088CC]/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0088CC]/8 via-[#0077B5]/5 to-[#005F8C]/8" />
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#0088CC]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />

        <div className="relative p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#0088CC] to-[#005F8C] flex items-center justify-center shadow-lg shadow-[#0088CC]/20 flex-shrink-0">
              <TelegramLogo className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold">Telegram Bot API</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#0088CC]/15 text-[#0088CC] border border-[#0088CC]/25">
                  <ShieldCheck className="h-3 w-3" />
                  Official API
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Powered by the official{' '}
                <a href="https://core.telegram.org/bots/api" target="_blank" rel="noopener noreferrer" className="text-[#0088CC] hover:underline">
                  Telegram Bot API
                </a>
                . Create your bot via @BotFather, paste the token, and you're live.
              </p>
              <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#0088CC]" />
                  Instant setup
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#0088CC]" />
                  Webhook support
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#0088CC]" />
                  Groups &amp; channels
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#0088CC]" />
                  Free &amp; unlimited
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SettingsCard
        title="Connection"
        description="Connect your Telegram bot"
      >
        <div className="space-y-6">
          {/* Connection Status */}
          <div className="flex items-start gap-4">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              status?.connected
                ? 'bg-gradient-to-br from-[#0088CC]/20 to-[#005F8C]/20 ring-1 ring-[#0088CC]/30'
                : 'bg-muted'
            )}>
              <TelegramLogo className={cn(
                'h-6 w-6',
                status?.connected ? 'text-[#0088CC]' : 'text-muted-foreground'
              )} />
            </div>

            <div className="flex-1 min-w-0">
              {isLoadingStatus ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking connection...</span>
                </div>
              ) : status?.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#0088CC]" />
                    <span className="font-medium">@{status.bot?.username}</span>
                    {status.latencyMs && (
                      <span className="text-xs text-muted-foreground">({status.latencyMs}ms)</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{status.bot?.name}</p>

                  {status.allowlists && (status.allowlists.users > 0 || status.allowlists.chats > 0) && (
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#0088CC]" />
                      <span>
                        {status.allowlists.users > 0 && `${status.allowlists.users} allowed users`}
                        {status.allowlists.users > 0 && status.allowlists.chats > 0 && ', '}
                        {status.allowlists.chats > 0 && `${status.allowlists.chats} allowed chats`}
                      </span>
                    </div>
                  )}
                </>
              ) : status?.configured ? (
                <>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    <span className="text-muted-foreground">Configured but not connected</span>
                  </div>
                  {status.error && <p className="text-xs text-red-500 mt-1">{status.error}</p>}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Not configured</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create a bot via{' '}
                    <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-[#0088CC] hover:underline">
                      @BotFather
                    </a>{' '}
                    to get started
                  </p>
                </>
              )}
            </div>

            <Button variant="ghost" size="sm" onClick={handleRefreshAll} disabled={isLoadingStatus} className="h-8 w-8 p-0">
              <RefreshCw className={cn('h-4 w-4', isLoadingStatus && 'animate-spin')} />
            </Button>
          </div>

          {/* Bot Token Configuration */}
          {!status?.connected && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Bot Token</p>
                  <p className="text-xs text-muted-foreground">From @BotFather on Telegram</p>
                </div>
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#0088CC] hover:underline flex items-center gap-1"
                >
                  Open BotFather <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="space-y-1.5">
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="123456789:ABCdefGHI..."
                    className="font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                onClick={() => saveConfigMutation.mutate(tokenInput.trim())}
                disabled={!tokenInput.trim() || saveConfigMutation.isPending}
                className="w-full sm:w-auto bg-[#0088CC] hover:bg-[#006DA3] text-white"
              >
                {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Connect Telegram
              </Button>

              {/* Setup steps */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground/80">Quick setup:</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Open <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-[#0088CC] hover:underline">@BotFather</a> in Telegram</li>
                    <li>Send <code className="px-1 py-0.5 rounded bg-muted">/newbot</code> and follow the prompts</li>
                    <li>Copy the bot token and paste it above</li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Webhook Configuration */}
      {status?.connected && (
        <SettingsCard title="Webhook" description="Configure how profClaw receives messages">
          <div className="space-y-4">
            {/* Current webhook status */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <Link2 className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 min-w-0">
                {webhookInfo?.url ? (
                  <>
                    <p className="text-sm font-medium text-green-600">Webhook Active</p>
                    <p className="text-xs text-muted-foreground truncate font-mono">{webhookInfo.url}</p>
                    {webhookInfo.pendingUpdateCount > 0 && (
                      <p className="text-xs text-yellow-600 mt-1">{webhookInfo.pendingUpdateCount} pending updates</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">No Webhook Set</p>
                    <p className="text-xs text-muted-foreground">Set a webhook URL so Telegram can deliver messages to profClaw</p>
                  </>
                )}
              </div>
              {webhookInfo?.url && (
                <Button variant="ghost" size="sm" onClick={() => deleteWebhookMutation.mutate()} disabled={deleteWebhookMutation.isPending} className="text-red-500 hover:text-red-600">
                  {deleteWebhookMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                </Button>
              )}
            </div>

            {/* Auto-detected webhook URL */}
            {!webhookInfo?.url && (
              <div className="space-y-3 p-3 rounded-lg border border-[#0088CC]/20 bg-[#0088CC]/5">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-[#0088CC]" />
                  <p className="text-sm font-medium">Suggested Webhook URL</p>
                </div>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/api/telegram/webhook`}
                    className="font-mono text-sm bg-background"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/telegram/webhook`);
                      toast.success('URL copied!');
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    className="bg-[#0088CC] hover:bg-[#0077B5] text-white"
                    onClick={() => setWebhookMutation.mutate(`${window.location.origin}/api/telegram/webhook`)}
                    disabled={setWebhookMutation.isPending}
                  >
                    {setWebhookMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                    Use This URL
                  </Button>
                  <span className="text-xs text-muted-foreground">or enter a custom URL below</span>
                </div>
              </div>
            )}

            {/* Custom webhook URL input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{webhookInfo?.url ? 'Change Webhook URL' : 'Custom Webhook URL'}</label>
              <div className="flex items-center gap-2">
                <Input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://your-domain.com/api/telegram/webhook"
                />
                <Button
                  onClick={() => setWebhookMutation.mutate(webhookUrl.trim())}
                  disabled={!webhookUrl.trim() || setWebhookMutation.isPending}
                  variant={webhookInfo?.url ? 'outline' : 'default'}
                >
                  {setWebhookMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Set'}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Use a custom URL if profClaw is behind a reverse proxy or on a different domain
              </p>
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Test Message */}
      {status?.connected && (
        <SettingsCard title="Test Message" description="Verify the connection works">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Chat ID</label>
                <Input type="text" value={testChatId} onChange={(e) => setTestChatId(e.target.value)} placeholder="-100123456789" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <Input type="text" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} placeholder="Hello from profClaw!" />
              </div>
            </div>
            <Button onClick={() => testMessageMutation.mutate()} disabled={!testChatId.trim() || !testMessage.trim() || testMessageMutation.isPending}>
              {testMessageMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send Test Message
            </Button>
          </div>
        </SettingsCard>
      )}

      {/* Bot Management */}
      {status?.connected && (
        <SettingsCard title="Bot Management" description="Manage connected bots">
          <div className="space-y-4">
            {/* Current bot */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-[#0088CC]/20 bg-[#0088CC]/5">
              <div className="h-8 w-8 rounded-full bg-[#0088CC]/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-[#0088CC]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{status.bot?.username ? `@${status.bot.username}` : 'Connected Bot'}</p>
                <p className="text-xs text-muted-foreground">Primary bot &middot; Active</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              </Button>
            </div>

            {/* Multi-bot coming soon */}
            <div className="relative overflow-hidden rounded-lg border border-dashed border-muted-foreground/20 p-4">
              <div className="flex items-center gap-3 opacity-60">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  <Cloud className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Multi-Bot Support</p>
                  <p className="text-xs text-muted-foreground">Connect multiple Telegram bots for different teams or projects</p>
                </div>
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#0088CC]/10 text-[#0088CC] border border-[#0088CC]/20">
                  Coming Soon &mdash; Cloud
                </span>
              </div>
            </div>
          </div>
        </SettingsCard>
      )}
    </>
  );
}

// =============================================================================
// DISCORD CONFIG (Coming Soon)
// =============================================================================

function DiscordConfig() {
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [appIdInput, setAppIdInput] = useState('');
  const [publicKeyInput, setPublicKeyInput] = useState('');
  const [testChannelId, setTestChannelId] = useState('');
  const [testMessage, setTestMessage] = useState('Hello from profClaw!');

  // Fetch Discord status
  const { data: status, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery<DiscordStatus>({
    queryKey: ['discord-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/discord/status`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch Discord status');
      return res.json();
    },
    staleTime: 30000,
  });

  // Save config mutation
  const saveConfigMutation = useMutation({
    mutationFn: async (config: { botToken: string; applicationId: string; publicKey: string }) => {
      const res = await fetch(`${API_BASE}/api/discord/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save config');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success('Discord bot configured!', {
        description: `Connected as ${data.account.botUsername}`,
      });
      setTokenInput('');
      setAppIdInput('');
      setPublicKeyInput('');
      queryClient.invalidateQueries({ queryKey: ['discord-status'] });
    },
    onError: (error) => {
      toast.error('Failed to configure Discord', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Test message mutation
  const sendTestMutation = useMutation({
    mutationFn: async ({ channelId, text }: { channelId: string; text: string }) => {
      const res = await fetch(`${API_BASE}/api/discord/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel_id: channelId, text }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to send message');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Test message sent!');
    },
    onError: (error) => {
      toast.error('Failed to send message', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Disconnect bot mutation
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/discord/config`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to disconnect');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Discord bot disconnected');
      setTokenInput('');
      setAppIdInput('');
      setPublicKeyInput('');
      queryClient.invalidateQueries({ queryKey: ['discord-status'] });
    },
    onError: (error) => {
      toast.error('Failed to disconnect', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Get OAuth URL
  const getOAuthUrl = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/discord/oauth/url`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to get OAuth URL');
      const data = await res.json();
      window.open(data.url, '_blank');
    } catch (error) {
      toast.error('Failed to get OAuth URL');
    }
  };

  return (
    <>
      {/* Discord Hero Banner */}
      <div className="relative overflow-hidden rounded-xl border border-[#5865F2]/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#5865F2]/8 via-[#4752C4]/5 to-[#3C45A5]/8" />
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#5865F2]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />

        <div className="relative p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#5865F2] to-[#4752C4] flex items-center justify-center shadow-lg shadow-[#5865F2]/20 flex-shrink-0">
              <DiscordLogo className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold">Discord Bot API</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#5865F2]/15 text-[#5865F2] border border-[#5865F2]/25">
                  <ShieldCheck className="h-3 w-3" />
                  Official API
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Powered by the official{' '}
                <a href="https://discord.com/developers/docs" target="_blank" rel="noopener noreferrer" className="text-[#5865F2] hover:underline">
                  Discord API
                </a>
                . Add your bot to any server with slash commands, interactions, and real-time messaging.
              </p>
              <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#5865F2]" />
                  Slash commands
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#5865F2]" />
                  Interactions
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#5865F2]" />
                  Multi-server
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#5865F2]" />
                  Role-based access
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Card */}
      <SettingsCard title="Connection" description="Connect your Discord bot">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              status?.connected
                ? 'bg-gradient-to-br from-[#5865F2]/20 to-[#4752C4]/20 ring-1 ring-[#5865F2]/30'
                : 'bg-muted'
            )}>
              <DiscordLogo className={cn(
                'h-6 w-6',
                status?.connected ? 'text-[#5865F2]' : 'text-muted-foreground'
              )} />
            </div>

            <div className="flex-1 min-w-0">
              {isLoadingStatus ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking connection...</span>
                </div>
              ) : status?.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#5865F2]" />
                    <span className="font-medium">{status.bot?.username}</span>
                    {status.latencyMs && (
                      <span className="text-xs text-muted-foreground">({status.latencyMs}ms)</span>
                    )}
                  </div>

                  {status.allowlists && (
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#5865F2]" />
                      <span>
                        {status.allowlists.guilds} guilds, {status.allowlists.channels} channels, {status.allowlists.roles} roles
                      </span>
                    </div>
                  )}
                </>
              ) : status?.configured ? (
                <>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    <span className="text-muted-foreground">Configured but not connected</span>
                  </div>
                  {status?.error && <p className="text-xs text-red-500 mt-1">{status.error}</p>}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Not configured</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create an app at the{' '}
                    <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-[#5865F2] hover:underline">
                      Developer Portal
                    </a>{' '}
                    to get started
                  </p>
                </>
              )}
            </div>

            <Button variant="ghost" size="sm" onClick={() => refetchStatus()} disabled={isLoadingStatus} className="h-8 w-8 p-0">
              <RefreshCw className={cn('h-4 w-4', isLoadingStatus && 'animate-spin')} />
            </Button>
          </div>

          {/* Bot Credentials Form */}
          {!status?.connected && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Bot Credentials</p>
                  <p className="text-xs text-muted-foreground">From Discord Developer Portal</p>
                </div>
                <a
                  href="https://discord.com/developers/applications"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#5865F2] hover:underline flex items-center gap-1"
                >
                  Open Portal <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Application ID</label>
                  <Input
                    type="text"
                    placeholder="e.g., 1234567890123456789"
                    value={appIdInput}
                    onChange={(e) => setAppIdInput(e.target.value)}
                    className="font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">General Information &rarr; Application ID</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Public Key</label>
                  <Input
                    type="text"
                    placeholder="Hex string for Ed25519 verification"
                    value={publicKeyInput}
                    onChange={(e) => setPublicKeyInput(e.target.value)}
                    className="font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">General Information &rarr; Public Key</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Bot Token</label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      placeholder="Your bot token from Discord"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      className="font-mono pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Bot &rarr; Reset Token (only shown once)</p>
                </div>

                <Button
                  onClick={() => saveConfigMutation.mutate({
                    botToken: tokenInput,
                    applicationId: appIdInput,
                    publicKey: publicKeyInput,
                  })}
                  disabled={!tokenInput || !appIdInput || !publicKeyInput || saveConfigMutation.isPending}
                  className="w-full sm:w-auto bg-[#5865F2] hover:bg-[#4752C4] text-white"
                >
                  {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Connect Discord
                </Button>
              </div>

              {/* Setup steps */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground/80">Quick setup:</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-[#5865F2] hover:underline">Developer Portal</a> &rarr; New Application</li>
                    <li>Copy Application ID and Public Key from General Information</li>
                    <li>Go to Bot &rarr; Reset Token and copy it</li>
                    <li>Enable Message Content Intent under Privileged Gateway Intents</li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Interactions Endpoint */}
      {status?.configured && (
        <SettingsCard title="Interactions Endpoint" description="Configure this URL in your Discord application">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Interactions Endpoint URL</label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`${window.location.origin}/api/discord/interactions`}
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/api/discord/interactions`);
                    toast.success('URL copied!');
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Paste this in General Information &rarr; Interactions Endpoint URL
              </p>
            </div>

            <Button variant="outline" onClick={getOAuthUrl} className="border-[#5865F2]/30 text-[#5865F2] hover:bg-[#5865F2]/5">
              Add Bot to Server <ExternalLink className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </SettingsCard>
      )}

      {/* Test Message */}
      {status?.connected && (
        <SettingsCard title="Test Message" description="Send a test message to a channel">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Channel ID</label>
                <Input
                  type="text"
                  placeholder="e.g., 1234567890123456789"
                  value={testChannelId}
                  onChange={(e) => setTestChannelId(e.target.value)}
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">Right-click channel &rarr; Copy Channel ID</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Message</label>
                <Input
                  type="text"
                  placeholder="Hello from profClaw!"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                />
              </div>
            </div>
            <Button
              onClick={() => sendTestMutation.mutate({ channelId: testChannelId, text: testMessage })}
              disabled={!testChannelId || !testMessage || sendTestMutation.isPending}
            >
              {sendTestMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Test Message
            </Button>
          </div>
        </SettingsCard>
      )}

      {/* Bot Management */}
      {status?.connected && (
        <SettingsCard title="Bot Management" description="Manage connected bots">
          <div className="space-y-4">
            {/* Current bot */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-[#5865F2]/20 bg-[#5865F2]/5">
              <div className="h-8 w-8 rounded-full bg-[#5865F2]/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-[#5865F2]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{status.bot?.username ? `${status.bot.username}` : 'Connected Bot'}</p>
                <p className="text-xs text-muted-foreground">Primary bot &middot; Active</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              </Button>
            </div>

            {/* Multi-bot coming soon */}
            <div className="relative overflow-hidden rounded-lg border border-dashed border-muted-foreground/20 p-4">
              <div className="flex items-center gap-3 opacity-60">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  <Cloud className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Multi-Bot Support</p>
                  <p className="text-xs text-muted-foreground">Connect multiple Discord bots for different servers or purposes</p>
                </div>
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/20">
                  Coming Soon &mdash; Cloud
                </span>
              </div>
            </div>
          </div>
        </SettingsCard>
      )}
    </>
  );
}

// =============================================================================
// WHATSAPP CONFIG
// =============================================================================

function WhatsAppConfig() {
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('Hello from profClaw!');

  // Fetch WhatsApp status
  const { data: status, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery<WhatsAppStatus>({
    queryKey: ['whatsapp-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/whatsapp/status`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch WhatsApp status');
      return res.json();
    },
    staleTime: 30000,
  });

  // Save config mutation
  const saveConfigMutation = useMutation({
    mutationFn: async (data: { phoneNumberId: string; accessToken: string; appSecret?: string }) => {
      const res = await fetch(`${API_BASE}/api/whatsapp/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save config');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success('WhatsApp configured!', {
        description: data.account.phoneNumber ? `Connected as ${data.account.phoneNumber}` : 'Connected successfully',
      });
      setPhoneNumberId('');
      setAccessToken('');
      setAppSecret('');
      if (data.webhookVerifyToken) {
        navigator.clipboard.writeText(data.webhookVerifyToken);
        toast.info('Webhook verify token copied to clipboard');
      }
      queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] });
    },
    onError: (error) => {
      toast.error('Failed to configure WhatsApp', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Test message mutation
  const testMessageMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/whatsapp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ to: testPhone, text: testMessage }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to send message');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Test message sent!');
    },
    onError: (error) => {
      toast.error('Failed to send message', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/whatsapp/config`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to disconnect');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('WhatsApp disconnected');
      setPhoneNumberId('');
      setAccessToken('');
      setAppSecret('');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] });
    },
    onError: (error) => {
      toast.error('Failed to disconnect', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const handleSaveConfig = () => {
    saveConfigMutation.mutate({
      phoneNumberId: phoneNumberId.trim(),
      accessToken: accessToken.trim(),
      appSecret: appSecret.trim() || undefined,
    });
  };

  return (
    <>
      {/* Official API Hero Banner */}
      <div className="relative overflow-hidden rounded-xl border border-[#25D366]/20">
        {/* WhatsApp gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#25D366]/8 via-[#128C7E]/5 to-[#075E54]/8" />
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#25D366]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />

        <div className="relative p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] flex items-center justify-center shadow-lg shadow-[#25D366]/20 flex-shrink-0">
              <WhatsAppLogo className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold">WhatsApp Business Cloud API</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#25D366]/15 text-[#25D366] border border-[#25D366]/25">
                  <ShieldCheck className="h-3 w-3" />
                  Official API
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Powered by Meta's official{' '}
                <a href="https://developers.facebook.com/docs/whatsapp/cloud-api" target="_blank" rel="noopener noreferrer" className="text-[#25D366] hover:underline">
                  WhatsApp Business Cloud API
                </a>
                {' '}&mdash; stable, enterprise-ready, and fully compliant with Meta's Terms of Service. No risk of account bans.
              </p>
              <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#25D366]" />
                  ToS compliant
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#25D366]" />
                  No ban risk
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#25D366]" />
                  1,000 free msgs/month
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-[#25D366]" />
                  Webhook verified
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SettingsCard
        title="Connection"
        description="Connect your WhatsApp Business account"
      >
        <div className="space-y-6">
          {/* Connection Status */}
          <div className="flex items-start gap-4">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              status?.connected
                ? 'bg-gradient-to-br from-[#25D366]/20 to-[#128C7E]/20 ring-1 ring-[#25D366]/30'
                : 'bg-muted'
            )}>
              <WhatsAppLogo className={cn(
                'h-6 w-6',
                status?.connected ? 'text-[#25D366]' : 'text-muted-foreground'
              )} />
            </div>

            <div className="flex-1 min-w-0">
              {isLoadingStatus ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking connection...</span>
                </div>
              ) : status?.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#25D366]" />
                    <span className="font-medium">{status.phone?.displayPhoneNumber}</span>
                    {status.latencyMs && (
                      <span className="text-xs text-muted-foreground">({status.latencyMs}ms)</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{status.phone?.verifiedName}</p>
                  {status.phone?.qualityRating && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Quality: {status.phone.qualityRating}
                    </p>
                  )}

                  {status.allowlist && status.allowlist.phones > 0 && (
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#25D366]" />
                      <span>{status.allowlist.phones} allowed phone numbers</span>
                    </div>
                  )}
                </>
              ) : status?.configured ? (
                <>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    <span className="text-muted-foreground">Configured but not connected</span>
                  </div>
                  {status.error && <p className="text-xs text-red-500 mt-1">{status.error}</p>}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Not configured</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Set up via{' '}
                    <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="text-[#25D366] hover:underline">
                      Meta Developer Dashboard
                    </a>{' '}
                    to get started
                  </p>
                </>
              )}
            </div>

            <Button variant="ghost" size="sm" onClick={() => refetchStatus()} disabled={isLoadingStatus} className="h-8 w-8 p-0">
              <RefreshCw className={cn('h-4 w-4', isLoadingStatus && 'animate-spin')} />
            </Button>
          </div>

          {/* Configuration Form */}
          {!status?.connected && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">API Credentials</p>
                  <p className="text-xs text-muted-foreground">From your Meta App Dashboard</p>
                </div>
                <a
                  href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#25D366] hover:underline flex items-center gap-1"
                >
                  Setup Guide <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Phone Number ID</label>
                  <Input
                    type="text"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    placeholder="1234567890..."
                    className="font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Access Token</label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder="EAAxxxxxxxxx..."
                      className="font-mono pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    App Secret <span className="text-muted-foreground font-normal">(for webhook verification)</span>
                  </label>
                  <Input
                    type="password"
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    placeholder="Optional but recommended"
                    className="font-mono"
                  />
                </div>

                <Button
                  onClick={handleSaveConfig}
                  disabled={!phoneNumberId.trim() || !accessToken.trim() || saveConfigMutation.isPending}
                  className="w-full sm:w-auto bg-[#25D366] hover:bg-[#128C7E] text-white"
                >
                  {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Connect WhatsApp
                </Button>
              </div>

              {/* Why official API */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <p>
                  profClaw uses the official WhatsApp Business Cloud API &mdash; not unofficial libraries like Baileys or whatsapp-web.js. This means no QR code scanning, no risk of your number being banned, and no breakage when WhatsApp updates their protocol.{' '}
                  <a href="https://developers.facebook.com/docs/whatsapp/cloud-api" target="_blank" rel="noopener noreferrer" className="text-[#25D366] hover:underline">
                    Learn more
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Webhook Info */}
      {status?.connected && (
        <SettingsCard title="Webhook Configuration" description="Configure Meta webhook for receiving messages">
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50 space-y-2">
              <p className="text-sm font-medium">Webhook URL</p>
              <code className="text-xs font-mono text-muted-foreground block break-all">
                {window.location.origin}/api/whatsapp/webhook
              </code>
            </div>
            <p className="text-xs text-muted-foreground">
              Add this URL in your{' '}
              <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Meta App Dashboard
              </a>{' '}
              under WhatsApp {'>'} Configuration {'>'} Webhook. Subscribe to the &quot;messages&quot; field.
            </p>
          </div>
        </SettingsCard>
      )}

      {/* Test Message */}
      {status?.connected && (
        <SettingsCard title="Test Message" description="Verify the connection works">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Phone Number</label>
                <Input
                  type="text"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+1234567890"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <Input
                  type="text"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  placeholder="Hello from profClaw!"
                />
              </div>
            </div>
            <Button
              onClick={() => testMessageMutation.mutate()}
              disabled={!testPhone.trim() || !testMessage.trim() || testMessageMutation.isPending}
            >
              {testMessageMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send Test Message
            </Button>
          </div>
        </SettingsCard>
      )}

      {/* Number Management */}
      {status?.connected && (
        <SettingsCard title="Number Management" description="Manage connected WhatsApp numbers">
          <div className="space-y-4">
            {/* Current number */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-[#25D366]/20 bg-[#25D366]/5">
              <div className="h-8 w-8 rounded-full bg-[#25D366]/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-[#25D366]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{status.phone?.displayPhoneNumber || status.phone?.verifiedName || 'Connected Number'}</p>
                <p className="text-xs text-muted-foreground">
                  Primary number{status.phone?.qualityRating ? ` \u00B7 Quality: ${status.phone.qualityRating}` : ' \u00B7 Active'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              </Button>
            </div>

            {/* Multi-number coming soon */}
            <div className="relative overflow-hidden rounded-lg border border-dashed border-muted-foreground/20 p-4">
              <div className="flex items-center gap-3 opacity-60">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  <Cloud className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Multi-Number Support</p>
                  <p className="text-xs text-muted-foreground">Connect multiple WhatsApp Business numbers for different teams</p>
                </div>
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20">
                  Coming Soon &mdash; Cloud
                </span>
              </div>
            </div>
          </div>
        </SettingsCard>
      )}
    </>
  );
}

// =============================================================================
// SLACK CONFIG
// =============================================================================

function SlackConfig() {
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [signingSecretInput, setSigningSecretInput] = useState('');
  const [appTokenInput, setAppTokenInput] = useState('');

  const { data: status, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery<{
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
    error?: string;
    bot?: { id: string; name: string; teamName: string };
  }>({
    queryKey: ['slack-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/slack/status`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch Slack status');
      return res.json();
    },
    staleTime: 30000,
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (config: { botToken: string; signingSecret: string; appToken?: string }) => {
      const res = await fetch(`${API_BASE}/api/slack/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save config');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Slack bot configured!');
      setTokenInput('');
      setSigningSecretInput('');
      setAppTokenInput('');
      queryClient.invalidateQueries({ queryKey: ['slack-status'] });
    },
    onError: (error) => {
      toast.error('Failed to configure Slack', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/slack/config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Slack bot disconnected');
      queryClient.invalidateQueries({ queryKey: ['slack-status'] });
    },
    onError: (error) => {
      toast.error('Failed to disconnect', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  return (
    <>
      {/* Slack Hero Banner */}
      <div className="relative overflow-hidden rounded-xl border border-[#4A154B]/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#4A154B]/8 via-[#4A154B]/5 to-[#611f69]/8" />
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#4A154B]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
        <div className="relative p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#4A154B] to-[#611f69] flex items-center justify-center shadow-lg shadow-[#4A154B]/20 flex-shrink-0">
              <SlackLogo className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold">Slack (Bolt SDK)</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#4A154B]/15 text-[#4A154B] border border-[#4A154B]/25">
                  <ShieldCheck className="h-3 w-3" />
                  Official SDK
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Connect via the{' '}
                <a href="https://api.slack.com/" target="_blank" rel="noopener noreferrer" className="text-[#4A154B] hover:underline">
                  Slack Bolt SDK
                </a>
                . Create a Slack App, add the Bot Token and Signing Secret.
              </p>
              <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
                {['Slash commands', 'Thread replies', 'Channel notifications', 'App Home tab'].map((f) => (
                  <span key={f} className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-[#4A154B]" />
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <SettingsCard title="Connection" description="Connect your Slack bot">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              status?.connected
                ? 'bg-gradient-to-br from-[#4A154B]/20 to-[#611f69]/20 ring-1 ring-[#4A154B]/30'
                : 'bg-muted'
            )}>
              <SlackLogo className={cn('h-6 w-6', status?.connected ? 'text-[#4A154B]' : 'text-muted-foreground')} />
            </div>
            <div className="flex-1 min-w-0">
              {isLoadingStatus ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking connection...</span>
                </div>
              ) : status?.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#4A154B]" />
                    <span className="font-medium">{status.bot?.name}</span>
                    {status.latencyMs && <span className="text-xs text-muted-foreground">({status.latencyMs}ms)</span>}
                  </div>
                  <p className="text-sm text-muted-foreground">{status.bot?.teamName}</p>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{status?.configured ? 'Configured but not connected' : 'Not configured'}</span>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchStatus()} disabled={isLoadingStatus} className="h-8 w-8 p-0">
              <RefreshCw className={cn('h-4 w-4', isLoadingStatus && 'animate-spin')} />
            </Button>
          </div>

          {!status?.connected && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div>
                <p className="text-sm font-medium">Bot Token</p>
                <p className="text-xs text-muted-foreground mb-2">xoxb-... token from your Slack App</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="xoxb-..."
                    />
                    <button
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">Signing Secret</p>
                <p className="text-xs text-muted-foreground mb-2">From App Credentials page</p>
                <Input
                  type="password"
                  value={signingSecretInput}
                  onChange={(e) => setSigningSecretInput(e.target.value)}
                  placeholder="Signing secret..."
                />
              </div>
              <div>
                <p className="text-sm font-medium">App-Level Token (optional)</p>
                <p className="text-xs text-muted-foreground mb-2">xapp-... for Socket Mode</p>
                <Input
                  type="password"
                  value={appTokenInput}
                  onChange={(e) => setAppTokenInput(e.target.value)}
                  placeholder="xapp-..."
                />
              </div>
              <Button
                onClick={() => saveConfigMutation.mutate({ botToken: tokenInput, signingSecret: signingSecretInput, appToken: appTokenInput || undefined })}
                disabled={!tokenInput.trim() || !signingSecretInput.trim() || saveConfigMutation.isPending}
                className="bg-[#4A154B] hover:bg-[#611f69]"
              >
                {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                Connect Slack Bot
              </Button>
            </div>
          )}

          {status?.connected && (
            <div className="pt-4 border-t border-border">
              <Button
                variant="outline"
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Unlink className="h-4 w-4 mr-2" />}
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </SettingsCard>
    </>
  );
}

// =============================================================================
// MATRIX CONFIG
// =============================================================================

function MatrixConfig() {
  const queryClient = useQueryClient();
  const [homeserverUrl, setHomeserverUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [userId, setUserId] = useState('');
  const [showToken, setShowToken] = useState(false);

  const { data: status, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery<{
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
    error?: string;
    user?: { userId: string; displayName: string; homeserver: string };
  }>({
    queryKey: ['matrix-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/matrix/status`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch Matrix status');
      return res.json();
    },
    staleTime: 30000,
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (config: { homeserverUrl: string; accessToken: string; userId: string }) => {
      const res = await fetch(`${API_BASE}/api/matrix/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save config');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Matrix bot configured!');
      setHomeserverUrl('');
      setAccessToken('');
      setUserId('');
      queryClient.invalidateQueries({ queryKey: ['matrix-status'] });
    },
    onError: (error) => {
      toast.error('Failed to configure Matrix', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/matrix/config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Matrix bot disconnected');
      queryClient.invalidateQueries({ queryKey: ['matrix-status'] });
    },
    onError: (error) => {
      toast.error('Failed to disconnect', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  return (
    <>
      {/* Matrix Hero Banner */}
      <div className="relative overflow-hidden rounded-xl border border-[#0DBD8B]/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0DBD8B]/8 via-[#0DBD8B]/5 to-[#00886A]/8" />
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#0DBD8B]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
        <div className="relative p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#0DBD8B] to-[#00886A] flex items-center justify-center shadow-lg shadow-[#0DBD8B]/20 flex-shrink-0">
              <MatrixLogo className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold">Matrix Protocol</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#0DBD8B]/15 text-[#0DBD8B] border border-[#0DBD8B]/25">
                  <ShieldCheck className="h-3 w-3" />
                  Decentralized
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Connect to any{' '}
                <a href="https://matrix.org/" target="_blank" rel="noopener noreferrer" className="text-[#0DBD8B] hover:underline">
                  Matrix
                </a>{' '}
                homeserver. Works with Element, Synapse, Dendrite, and others.
              </p>
              <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
                {['Room-based chat', 'E2EE optional', 'Federation', 'Self-hosted'].map((f) => (
                  <span key={f} className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-[#0DBD8B]" />
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <SettingsCard title="Connection" description="Connect to a Matrix homeserver">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              status?.connected
                ? 'bg-gradient-to-br from-[#0DBD8B]/20 to-[#00886A]/20 ring-1 ring-[#0DBD8B]/30'
                : 'bg-muted'
            )}>
              <MatrixLogo className={cn('h-6 w-6', status?.connected ? 'text-[#0DBD8B]' : 'text-muted-foreground')} />
            </div>
            <div className="flex-1 min-w-0">
              {isLoadingStatus ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking connection...</span>
                </div>
              ) : status?.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#0DBD8B]" />
                    <span className="font-medium">{status.user?.displayName || status.user?.userId}</span>
                    {status.latencyMs && <span className="text-xs text-muted-foreground">({status.latencyMs}ms)</span>}
                  </div>
                  <p className="text-sm text-muted-foreground">{status.user?.homeserver}</p>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{status?.configured ? 'Configured but not connected' : 'Not configured'}</span>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchStatus()} disabled={isLoadingStatus} className="h-8 w-8 p-0">
              <RefreshCw className={cn('h-4 w-4', isLoadingStatus && 'animate-spin')} />
            </Button>
          </div>

          {!status?.connected && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div>
                <p className="text-sm font-medium">Homeserver URL</p>
                <p className="text-xs text-muted-foreground mb-2">e.g. https://matrix.org or your self-hosted server</p>
                <Input
                  value={homeserverUrl}
                  onChange={(e) => setHomeserverUrl(e.target.value)}
                  placeholder="https://matrix.org"
                />
              </div>
              <div>
                <p className="text-sm font-medium">User ID</p>
                <p className="text-xs text-muted-foreground mb-2">Full Matrix user ID</p>
                <Input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="@bot:matrix.org"
                />
              </div>
              <div>
                <p className="text-sm font-medium">Access Token</p>
                <p className="text-xs text-muted-foreground mb-2">From Element Settings or /_matrix/client/v3/login</p>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="syt_..."
                  />
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button
                onClick={() => saveConfigMutation.mutate({ homeserverUrl, accessToken, userId })}
                disabled={!homeserverUrl.trim() || !accessToken.trim() || !userId.trim() || saveConfigMutation.isPending}
                className="bg-[#0DBD8B] hover:bg-[#00886A] text-white"
              >
                {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                Connect to Matrix
              </Button>
            </div>
          )}

          {status?.connected && (
            <div className="pt-4 border-t border-border">
              <Button
                variant="outline"
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Unlink className="h-4 w-4 mr-2" />}
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </SettingsCard>
    </>
  );
}

// =============================================================================
// GOOGLE CHAT CONFIG
// =============================================================================

function GoogleChatConfig() {
  const queryClient = useQueryClient();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [serviceAccountKey, setServiceAccountKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [mode, setMode] = useState<'webhook' | 'service-account'>('webhook');

  const { data: status, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery<{
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
    error?: string;
    space?: { name: string; displayName: string };
  }>({
    queryKey: ['googlechat-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/googlechat/status`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch Google Chat status');
      return res.json();
    },
    staleTime: 30000,
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (config: { webhookUrl?: string; serviceAccountKey?: string; projectId?: string }) => {
      const res = await fetch(`${API_BASE}/api/googlechat/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save config');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Google Chat configured!');
      setWebhookUrl('');
      setServiceAccountKey('');
      setProjectId('');
      queryClient.invalidateQueries({ queryKey: ['googlechat-status'] });
    },
    onError: (error) => {
      toast.error('Failed to configure Google Chat', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/googlechat/config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Google Chat disconnected');
      queryClient.invalidateQueries({ queryKey: ['googlechat-status'] });
    },
    onError: (error) => {
      toast.error('Failed to disconnect', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  return (
    <>
      {/* Google Chat Hero Banner */}
      <div className="relative overflow-hidden rounded-xl border border-[#00AC47]/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#00AC47]/8 via-[#00AC47]/5 to-[#00832D]/8" />
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#00AC47]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
        <div className="relative p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#00AC47] to-[#00832D] flex items-center justify-center shadow-lg shadow-[#00AC47]/20 flex-shrink-0">
              <GoogleChatLogo className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold">Google Chat</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#00AC47]/15 text-[#00AC47] border border-[#00AC47]/25">
                  <ShieldCheck className="h-3 w-3" />
                  Workspace
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Integrate with{' '}
                <a href="https://developers.google.com/chat" target="_blank" rel="noopener noreferrer" className="text-[#00AC47] hover:underline">
                  Google Chat
                </a>
                . Use webhook mode for simple notifications, or service account for full interactivity.
              </p>
              <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
                {['Spaces', 'Threads', 'Cards v2', 'Webhook + API'].map((f) => (
                  <span key={f} className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-[#00AC47]" />
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <SettingsCard title="Connection" description="Connect to Google Chat">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              status?.connected
                ? 'bg-gradient-to-br from-[#00AC47]/20 to-[#00832D]/20 ring-1 ring-[#00AC47]/30'
                : 'bg-muted'
            )}>
              <GoogleChatLogo className={cn('h-6 w-6', status?.connected ? 'text-[#00AC47]' : 'text-muted-foreground')} />
            </div>
            <div className="flex-1 min-w-0">
              {isLoadingStatus ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking connection...</span>
                </div>
              ) : status?.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#00AC47]" />
                    <span className="font-medium">{status.space?.displayName || 'Connected'}</span>
                    {status.latencyMs && <span className="text-xs text-muted-foreground">({status.latencyMs}ms)</span>}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{status?.configured ? 'Configured but not connected' : 'Not configured'}</span>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchStatus()} disabled={isLoadingStatus} className="h-8 w-8 p-0">
              <RefreshCw className={cn('h-4 w-4', isLoadingStatus && 'animate-spin')} />
            </Button>
          </div>

          {!status?.connected && (
            <div className="space-y-4 pt-4 border-t border-border">
              {/* Mode Selector */}
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('webhook')}
                  className={cn(
                    'flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all',
                    mode === 'webhook' ? 'border-[#00AC47]/40 bg-[#00AC47]/8 text-[#00AC47]' : 'border-border hover:bg-muted/50'
                  )}
                >
                  Webhook (Simple)
                </button>
                <button
                  onClick={() => setMode('service-account')}
                  className={cn(
                    'flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all',
                    mode === 'service-account' ? 'border-[#00AC47]/40 bg-[#00AC47]/8 text-[#00AC47]' : 'border-border hover:bg-muted/50'
                  )}
                >
                  Service Account (Full)
                </button>
              </div>

              {mode === 'webhook' ? (
                <div>
                  <p className="text-sm font-medium">Webhook URL</p>
                  <p className="text-xs text-muted-foreground mb-2">From Google Chat space settings</p>
                  <Input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://chat.googleapis.com/v1/spaces/..."
                  />
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-medium">Project ID</p>
                    <p className="text-xs text-muted-foreground mb-2">Google Cloud project ID</p>
                    <Input
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      placeholder="my-project-123"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Service Account Key (JSON)</p>
                    <p className="text-xs text-muted-foreground mb-2">Paste the full JSON key contents</p>
                    <textarea
                      value={serviceAccountKey}
                      onChange={(e) => setServiceAccountKey(e.target.value)}
                      placeholder='{"type": "service_account", ...}'
                      className="w-full h-24 px-3 py-2 text-sm rounded-md border border-input bg-background font-mono resize-none"
                    />
                  </div>
                </>
              )}

              <Button
                onClick={() => saveConfigMutation.mutate(
                  mode === 'webhook'
                    ? { webhookUrl }
                    : { serviceAccountKey, projectId }
                )}
                disabled={
                  (mode === 'webhook' ? !webhookUrl.trim() : !serviceAccountKey.trim() || !projectId.trim())
                  || saveConfigMutation.isPending
                }
                className="bg-[#00AC47] hover:bg-[#00832D] text-white"
              >
                {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                Connect Google Chat
              </Button>
            </div>
          )}

          {status?.connected && (
            <div className="pt-4 border-t border-border">
              <Button
                variant="outline"
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Unlink className="h-4 w-4 mr-2" />}
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </SettingsCard>
    </>
  );
}

// =============================================================================
// MS TEAMS CONFIG
// =============================================================================

function TeamsConfig() {
  const queryClient = useQueryClient();
  const [appId, setAppId] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { data: status, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery<{
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
    error?: string;
    bot?: { name: string; tenantId: string };
  }>({
    queryKey: ['msteams-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/msteams/status`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch Teams status');
      return res.json();
    },
    staleTime: 30000,
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (config: { appId: string; appPassword: string; tenantId?: string }) => {
      const res = await fetch(`${API_BASE}/api/msteams/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save config');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Microsoft Teams bot configured!');
      setAppId('');
      setAppPassword('');
      setTenantId('');
      queryClient.invalidateQueries({ queryKey: ['msteams-status'] });
    },
    onError: (error) => {
      toast.error('Failed to configure Teams', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/msteams/config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Teams bot disconnected');
      queryClient.invalidateQueries({ queryKey: ['msteams-status'] });
    },
    onError: (error) => {
      toast.error('Failed to disconnect', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  return (
    <>
      {/* Teams Hero Banner */}
      <div className="relative overflow-hidden rounded-xl border border-[#5059C9]/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#5059C9]/8 via-[#5059C9]/5 to-[#7B83EB]/8" />
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#5059C9]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
        <div className="relative p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#5059C9] to-[#7B83EB] flex items-center justify-center shadow-lg shadow-[#5059C9]/20 flex-shrink-0">
              <TeamsLogo className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold">Microsoft Teams</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#5059C9]/15 text-[#5059C9] border border-[#5059C9]/25">
                  <ShieldCheck className="h-3 w-3" />
                  Bot Framework
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Connect via{' '}
                <a href="https://dev.teams.microsoft.com/" target="_blank" rel="noopener noreferrer" className="text-[#5059C9] hover:underline">
                  Microsoft Bot Framework
                </a>
                . Register your bot app in Azure AD, then add the credentials here.
              </p>
              <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
                {['Adaptive Cards', 'Channel messages', 'Mentions', 'SSO auth'].map((f) => (
                  <span key={f} className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-[#5059C9]" />
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <SettingsCard title="Connection" description="Connect your Teams bot">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              status?.connected
                ? 'bg-gradient-to-br from-[#5059C9]/20 to-[#7B83EB]/20 ring-1 ring-[#5059C9]/30'
                : 'bg-muted'
            )}>
              <TeamsLogo className={cn('h-6 w-6', status?.connected ? 'text-[#5059C9]' : 'text-muted-foreground')} />
            </div>
            <div className="flex-1 min-w-0">
              {isLoadingStatus ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking connection...</span>
                </div>
              ) : status?.connected ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#5059C9]" />
                    <span className="font-medium">{status.bot?.name || 'Connected'}</span>
                    {status.latencyMs && <span className="text-xs text-muted-foreground">({status.latencyMs}ms)</span>}
                  </div>
                  {status.bot?.tenantId && <p className="text-sm text-muted-foreground">Tenant: {status.bot.tenantId}</p>}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{status?.configured ? 'Configured but not connected' : 'Not configured'}</span>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchStatus()} disabled={isLoadingStatus} className="h-8 w-8 p-0">
              <RefreshCw className={cn('h-4 w-4', isLoadingStatus && 'animate-spin')} />
            </Button>
          </div>

          {!status?.connected && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div>
                <p className="text-sm font-medium">App (Client) ID</p>
                <p className="text-xs text-muted-foreground mb-2">From Azure AD App Registration</p>
                <Input
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
              <div>
                <p className="text-sm font-medium">App Password (Client Secret)</p>
                <p className="text-xs text-muted-foreground mb-2">From Certificates & Secrets</p>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={appPassword}
                    onChange={(e) => setAppPassword(e.target.value)}
                    placeholder="Client secret value..."
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">Tenant ID (optional)</p>
                <p className="text-xs text-muted-foreground mb-2">Leave blank for multi-tenant bots</p>
                <Input
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
              <Button
                onClick={() => saveConfigMutation.mutate({ appId, appPassword, tenantId: tenantId || undefined })}
                disabled={!appId.trim() || !appPassword.trim() || saveConfigMutation.isPending}
                className="bg-[#5059C9] hover:bg-[#4B53BC] text-white"
              >
                {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                Connect Teams Bot
              </Button>
            </div>
          )}

          {status?.connected && (
            <div className="pt-4 border-t border-border">
              <Button
                variant="outline"
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Unlink className="h-4 w-4 mr-2" />}
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </SettingsCard>
    </>
  );
}

// =============================================================================
// GROUP CHAT CONFIG
// =============================================================================

interface GroupChatConfigData {
  mentionGating: boolean;
  threading: boolean;
  rateLimits: {
    default: number;
    perChannel: Record<string, number>;
  };
  personalities: Record<string, string>;
}

interface RateLimitOverride {
  channelId: string;
  maxPerMinute: number;
}

interface PersonalityOverride {
  channelId: string;
  systemPrompt: string;
}

function GroupChatConfig() {
  const queryClient = useQueryClient();

  const [rateLimitChannelId, setRateLimitChannelId] = useState('');
  const [maxPerMinute, setMaxPerMinute] = useState('');
  const [personalityChannelId, setPersonalityChannelId] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  const { data: config, isLoading } = useQuery<GroupChatConfigData>({
    queryKey: ['group-chat-config'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/chat/group/config`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch group chat config');
      return res.json() as Promise<GroupChatConfigData>;
    },
    staleTime: 30000,
  });

  const rateLimitMutation = useMutation<void, Error, RateLimitOverride>({
    mutationFn: async (payload) => {
      const res = await fetch(`${API_BASE}/api/chat/group/rate-limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save rate limit');
    },
    onSuccess: () => {
      toast.success('Rate limit saved');
      setRateLimitChannelId('');
      setMaxPerMinute('');
      void queryClient.invalidateQueries({ queryKey: ['group-chat-config'] });
    },
    onError: (err) => {
      toast.error(err.message ?? 'Failed to save rate limit');
    },
  });

  const personalityMutation = useMutation<void, Error, PersonalityOverride>({
    mutationFn: async (payload) => {
      const res = await fetch(`${API_BASE}/api/chat/group/personality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save personality');
    },
    onSuccess: () => {
      toast.success('Channel personality saved');
      setPersonalityChannelId('');
      setSystemPrompt('');
      void queryClient.invalidateQueries({ queryKey: ['group-chat-config'] });
    },
    onError: (err) => {
      toast.error(err.message ?? 'Failed to save personality');
    },
  });

  const parsedRate = parseInt(maxPerMinute, 10);
  const isRateLimitValid = rateLimitChannelId.trim().length > 0 && !isNaN(parsedRate) && parsedRate > 0;
  const isPersonalityValid = personalityChannelId.trim().length > 0 && systemPrompt.trim().length > 0;

  return (
    <>
      <div className="flex items-center gap-3 pt-2">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Users className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-base">Group Chat</h3>
          <p className="text-xs text-muted-foreground">Behaviour settings for group and multi-user channels</p>
        </div>
      </div>

      {/* Mention Gating */}
      <SettingsCard
        title="Mention Gating"
        description="Control when the bot responds in group conversations"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Only respond when @mentioned</p>
              <p className="text-xs text-muted-foreground">
                When enabled, the bot ignores messages that do not mention it directly
              </p>
            </div>
          </div>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              checked={config?.mentionGating ?? false}
              disabled
              aria-label="Mention gating status (read-only)"
            />
          )}
        </div>
        {!isLoading && config && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0" />
            This setting is managed via the config file. Restart the server after changing it.
          </p>
        )}
      </SettingsCard>

      {/* Rate Limits */}
      <SettingsCard
        title="Rate Limits"
        description="Throttle bot responses per channel to prevent spam"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
            <Gauge className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Default rate limit</p>
              <p className="text-xs text-muted-foreground">Applied to all channels without a specific override</p>
            </div>
            <span className="text-sm font-mono font-semibold tabular-nums">
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                `${config?.rateLimits?.default ?? '-'} / min`
              )}
            </span>
          </div>

          {!isLoading && config && Object.keys(config.rateLimits?.perChannel ?? {}).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Channel overrides</p>
              {Object.entries(config.rateLimits.perChannel).map(([channelId, limit]) => (
                <div
                  key={channelId}
                  className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-muted/20 text-sm"
                >
                  <span className="font-mono text-xs text-muted-foreground">{channelId}</span>
                  <span className="font-semibold tabular-nums">{limit} / min</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 pt-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add override</p>
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="rl-channel-id" className="text-xs">Channel ID</Label>
                <Input
                  id="rl-channel-id"
                  value={rateLimitChannelId}
                  onChange={(e) => setRateLimitChannelId(e.target.value)}
                  placeholder="e.g. C01234ABCDE or -1001234567890"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rl-max-per-min" className="text-xs">Max / min</Label>
                <Input
                  id="rl-max-per-min"
                  type="number"
                  min={1}
                  value={maxPerMinute}
                  onChange={(e) => setMaxPerMinute(e.target.value)}
                  placeholder="10"
                  className="text-sm w-24"
                />
              </div>
            </div>
            <Button
              size="sm"
              disabled={!isRateLimitValid || rateLimitMutation.isPending}
              onClick={() =>
                rateLimitMutation.mutate({ channelId: rateLimitChannelId.trim(), maxPerMinute: parsedRate })
              }
            >
              {rateLimitMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save Override
            </Button>
          </div>
        </div>
      </SettingsCard>

      {/* Channel Personality */}
      <SettingsCard
        title="Channel Personality"
        description="Give the bot a custom system prompt for a specific channel"
      >
        <div className="space-y-4">
          {!isLoading && config && Object.keys(config.personalities ?? {}).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active personalities</p>
              {Object.entries(config.personalities).map(([channelId, prompt]) => (
                <div key={channelId} className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
                  <p className="text-xs font-mono text-muted-foreground">{channelId}</p>
                  <p className="text-sm line-clamp-2">{prompt}</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Set personality</p>
            <div className="space-y-1.5">
              <Label htmlFor="persona-channel-id" className="text-xs">Channel ID</Label>
              <Input
                id="persona-channel-id"
                value={personalityChannelId}
                onChange={(e) => setPersonalityChannelId(e.target.value)}
                placeholder="e.g. C01234ABCDE or -1001234567890"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="persona-system-prompt" className="text-xs">System prompt</Label>
              <Textarea
                id="persona-system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a helpful assistant specialized in customer support..."
                rows={4}
                className="text-sm resize-y"
              />
            </div>
            <Button
              size="sm"
              disabled={!isPersonalityValid || personalityMutation.isPending}
              onClick={() =>
                personalityMutation.mutate({
                  channelId: personalityChannelId.trim(),
                  systemPrompt: systemPrompt.trim(),
                })
              }
            >
              {personalityMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Bot className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save Personality
            </Button>
          </div>
        </div>
      </SettingsCard>
    </>
  );
}
