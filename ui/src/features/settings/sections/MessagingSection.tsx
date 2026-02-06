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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SettingsCard } from '../components';
import { API_BASE } from '../constants';
import {
  TelegramLogo,
  DiscordLogo,
  WhatsAppLogo,
  SlackLogo,
} from '@/components/shared/ProviderLogos';

// =============================================================================
// TYPES
// =============================================================================

type MessagingProvider = 'telegram' | 'discord' | 'whatsapp' | 'slack';

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
    description: 'Coming soon',
    Logo: SlackLogo,
    color: 'text-[#4A154B]',
    bgColor: 'bg-[#4A154B]/10',
    activeBorder: 'border-[#4A154B]/40',
    activeBg: 'bg-[#4A154B]/8',
    docsUrl: 'https://api.slack.com/',
    setupUrl: 'https://api.slack.com/apps',
    status: 'coming-soon',
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
      {activeProvider === 'slack' && (
        <div className="relative overflow-hidden rounded-xl border border-[#4A154B]/20">
          <div className="absolute inset-0 bg-gradient-to-br from-[#4A154B]/8 via-[#4A154B]/5 to-[#611f69]/8" />
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#4A154B]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />

          <div className="relative p-6 sm:p-8 flex flex-col items-center text-center gap-4">
            <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-[#4A154B] to-[#611f69] flex items-center justify-center shadow-lg shadow-[#4A154B]/20">
              <SlackLogo className="h-7 w-7 text-white" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Slack Integration</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Connect GLINR to your Slack workspace for real-time task notifications, AI-powered conversations, and team collaboration.
              </p>
            </div>
            <span className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#4A154B]/10 text-[#4A154B] border border-[#4A154B]/20">
              Coming Soon &mdash; Cloud
            </span>
            <div className="flex flex-wrap justify-center gap-2 mt-1">
              {['Slash commands', 'Thread replies', 'Channel notifications', 'App Home tab'].map((feature) => (
                <span key={feature} className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                  {feature}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
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
  const [testMessage, setTestMessage] = useState('Hello from GLINR!');

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
        <SettingsCard title="Webhook" description="Configure how GLINR receives messages">
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
                    <p className="text-xs text-muted-foreground">Set a webhook URL so Telegram can deliver messages to GLINR</p>
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
                Use a custom URL if GLINR is behind a reverse proxy or on a different domain
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
                <Input type="text" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} placeholder="Hello from GLINR!" />
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
  const [testMessage, setTestMessage] = useState('Hello from GLINR!');

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
                  placeholder="Hello from GLINR!"
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
  const [testMessage, setTestMessage] = useState('Hello from GLINR!');

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
                  GLINR uses the official WhatsApp Business Cloud API &mdash; not unofficial libraries like Baileys or whatsapp-web.js. This means no QR code scanning, no risk of your number being banned, and no breakage when WhatsApp updates their protocol.{' '}
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
                  placeholder="Hello from GLINR!"
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
