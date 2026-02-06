/**
 * Tunnel Setup Banner
 *
 * Inline banner shown in provider config when webhooks are needed.
 * Shows active tunnel URL or one-click setup options.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Globe,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  Zap,
  Shield,
  AlertTriangle,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { API_BASE } from '@/features/settings/constants.js';

interface TunnelStatus {
  serverPort: number;
  tailscale: { available: boolean; funneling: boolean; url?: string };
  cloudflare: { available: boolean; running: boolean; activeUrl?: string };
}

interface TunnelSetupBannerProps {
  webhookPath?: string;
  providerColor: string;
}

async function postTunnel(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tunnels${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Request failed');
  }
}

export function TunnelSetupBanner({ webhookPath, providerColor }: TunnelSetupBannerProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: status, isLoading } = useQuery<TunnelStatus>({
    queryKey: ['tunnel-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/tunnels/status`);
      if (!res.ok) throw new Error('Failed to fetch tunnel status');
      return res.json() as Promise<TunnelStatus>;
    },
    refetchInterval: 10000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tunnel-status'] });
  const serverPort = status?.serverPort ?? 3000;
  const ts = status?.tailscale;
  const cf = status?.cloudflare;
  const cfAvailable = cf?.available ?? false;
  const tsAvailable = ts?.available ?? false;
  const neitherAvailable = !cfAvailable && !tsAvailable;

  const cfQuick = useMutation({
    mutationFn: () => postTunnel('/cloudflare/quick', { port: serverPort }),
    onSuccess: () => { toast.success('Tunnel started'); invalidate(); },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const tsFunnel = useMutation({
    mutationFn: () => postTunnel('/tailscale/funnel', { port: serverPort }),
    onSuccess: () => { toast.success('Tailscale Funnel started'); invalidate(); },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const cfInstall = useMutation({
    mutationFn: () => postTunnel('/cloudflare/install', {}),
    onSuccess: () => { toast.success('cloudflared installed'); invalidate(); },
    onError: (e: Error) => toast.error(`Install failed: ${e.message}`),
  });

  // Determine active tunnel URL
  const activeUrl = (cf?.running && cf.activeUrl)
    ? cf.activeUrl
    : (ts?.funneling && ts.url)
      ? ts.url
      : null;

  const fullWebhookUrl = activeUrl && webhookPath
    ? `${activeUrl}${webhookPath}`
    : activeUrl ?? null;

  const handleCopy = async () => {
    if (!fullWebhookUrl) return;
    await navigator.clipboard.writeText(fullWebhookUrl);
    setCopied(true);
    toast.success('Webhook URL copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const isStarting = cfQuick.isPending || tsFunnel.isPending;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-dashed p-4 flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Checking tunnel status...</span>
      </div>
    );
  }

  // Active tunnel - show webhook URL
  if (activeUrl) {
    return (
      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: `${providerColor}33` }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-green-500/10 flex items-center justify-center">
              <Globe className="h-3.5 w-3.5 text-green-500" />
            </div>
            <span className="text-sm font-medium text-green-600 dark:text-green-400">
              Public URL Active
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {cf?.running ? 'Cloudflare Tunnel' : 'Tailscale Funnel'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">Webhook URL</p>
            <p className="text-xs font-mono truncate text-foreground">{fullWebhookUrl}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0 gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Paste this URL into your provider's webhook settings.
        </p>
      </div>
    );
  }

  // No tunnel - show setup options
  return (
    <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-500/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-md bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Public URL Required</p>
          <p className="text-xs text-muted-foreground">
            This provider needs a public HTTPS URL for webhooks.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {cfAvailable && (
          <Button size="sm" variant="outline" onClick={() => cfQuick.mutate()} disabled={isStarting} className="gap-1.5">
            {cfQuick.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 text-orange-500" />}
            Quick Tunnel
          </Button>
        )}
        {tsAvailable && (
          <Button size="sm" variant="outline" onClick={() => tsFunnel.mutate()} disabled={isStarting} className="gap-1.5">
            {tsFunnel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5 text-blue-500" />}
            Tailscale Funnel
          </Button>
        )}
        {neitherAvailable && (
          <Button size="sm" variant="outline" onClick={() => cfInstall.mutate()} disabled={cfInstall.isPending} className="gap-1.5">
            {cfInstall.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-orange-500" />}
            {cfInstall.isPending ? 'Installing...' : 'Install cloudflared'}
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild className="gap-1.5 text-muted-foreground">
          <a href="/settings/tunnels">
            <ExternalLink className="h-3.5 w-3.5" />
            Settings
          </a>
        </Button>
      </div>
    </div>
  );
}
