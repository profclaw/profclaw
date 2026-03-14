/**
 * Tunnels Section
 *
 * Manage remote access tunnels via Tailscale or Cloudflare.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Globe,
  Wifi,
  Cloud,
  Copy,
  Check,
  Play,
  Square,
  ExternalLink,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SettingsCard } from '../components';
import { API_BASE } from '../constants';

// =============================================================================
// TYPES
// =============================================================================

interface TailscaleStatus {
  available: boolean;
  serving: boolean;
  funneling: boolean;
  url?: string;
  tailnet?: string;
}

interface CloudflareStatus {
  available: boolean;
  running: boolean;
  url?: string;
  name?: string;
}

interface TunnelStatus {
  tailscale: TailscaleStatus;
  cloudflare: CloudflareStatus;
}

// =============================================================================
// HELPERS
// =============================================================================

async function fetchTunnelStatus(): Promise<TunnelStatus> {
  const res = await fetch(`${API_BASE}/api/tunnels/status`);
  if (!res.ok) throw new Error('Failed to fetch tunnel status');
  return res.json() as Promise<TunnelStatus>;
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

// =============================================================================
// STATUS BADGE
// =============================================================================

function StatusBadge({ available, active }: { available: boolean; active: boolean }) {
  if (!available) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
        <AlertCircle className="size-3" />
        Not installed
      </span>
    );
  }
  if (active) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/15 text-green-600 dark:text-green-400">
        <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/50" />
      Idle
    </span>
  );
}

// =============================================================================
// COPY URL BUTTON
// =============================================================================

function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex items-center gap-2 mt-3 p-2.5 rounded-lg bg-muted/60 border border-border/50">
      <Globe className="size-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-foreground truncate flex-1 font-mono">{url}</span>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3" />
          </a>
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TunnelsSection() {
  const queryClient = useQueryClient();
  const [port, setPort] = useState('3000');
  const [cfName, setCfName] = useState('');
  const [cfDomain, setCfDomain] = useState('');

  const { data: status, isLoading } = useQuery({
    queryKey: ['tunnel-status'],
    queryFn: fetchTunnelStatus,
    refetchInterval: 10000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tunnel-status'] });

  const tsServe = useMutation({
    mutationFn: () => postTunnel('/tailscale/serve', { port: Number(port) }),
    onSuccess: () => { toast.success('Tailscale Serve started'); invalidate(); },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const tsFunnel = useMutation({
    mutationFn: () => postTunnel('/tailscale/funnel', { port: Number(port) }),
    onSuccess: () => { toast.success('Tailscale Funnel started'); invalidate(); },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const tsStop = useMutation({
    mutationFn: () => postTunnel('/tailscale/stop', {}),
    onSuccess: () => { toast.success('Tailscale tunnel stopped'); invalidate(); },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const cfQuick = useMutation({
    mutationFn: () => postTunnel('/cloudflare/quick', { port: Number(port) }),
    onSuccess: () => { toast.success('Cloudflare quick tunnel started'); invalidate(); },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const cfNamed = useMutation({
    mutationFn: () =>
      postTunnel('/cloudflare/named', {
        port: Number(port),
        name: cfName,
        ...(cfDomain ? { domain: cfDomain } : {}),
      }),
    onSuccess: () => { toast.success('Cloudflare named tunnel started'); invalidate(); },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const cfStop = useMutation({
    mutationFn: () => postTunnel('/cloudflare/stop', {}),
    onSuccess: () => { toast.success('Cloudflare tunnel stopped'); invalidate(); },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const ts = status?.tailscale;
  const cf = status?.cloudflare;
  const isTsActive = !!(ts?.serving || ts?.funneling);
  const anyMutating =
    tsServe.isPending || tsFunnel.isPending || tsStop.isPending ||
    cfQuick.isPending || cfNamed.isPending || cfStop.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Globe className="size-5" />
          Tunnels
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Expose profClaw to the internet securely via Tailscale or Cloudflare.
        </p>
      </div>

      {/* Shared Port Input */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium shrink-0">Local Port</label>
        <Input
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="w-28 h-8 text-sm"
          min={1}
          max={65535}
          disabled={anyMutating}
        />
        <span className="text-xs text-muted-foreground">Port to expose (default: 3000)</span>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking tunnel status...
        </div>
      )}

      {/* Tailscale Card */}
      <SettingsCard
        title="Tailscale"
        description="Share on your Tailnet (Serve) or make publicly accessible (Funnel)"
      >
        <div className="space-y-4">
          {/* Status row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wifi className="size-4 text-muted-foreground" />
              <StatusBadge available={ts?.available ?? false} active={isTsActive} />
              {ts?.tailnet && (
                <span className="text-xs text-muted-foreground">{ts.tailnet}</span>
              )}
              {ts?.funneling && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-500/15 text-blue-600 dark:text-blue-400">
                  Public funnel
                </span>
              )}
            </div>
          </div>

          {/* Active URL */}
          {ts?.url && isTsActive && <CopyUrlButton url={ts.url} />}

          {/* Action buttons */}
          <div className={cn('flex flex-wrap gap-2', !ts?.available && 'opacity-50 pointer-events-none')}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => tsServe.mutate()}
              disabled={anyMutating || isTsActive}
            >
              {tsServe.isPending ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <Play className="size-3.5 mr-1.5" />
              )}
              Start Serve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => tsFunnel.mutate()}
              disabled={anyMutating || isTsActive}
            >
              {tsFunnel.isPending ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <Globe className="size-3.5 mr-1.5" />
              )}
              Start Funnel
            </Button>
            {isTsActive && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => tsStop.mutate()}
                disabled={anyMutating}
              >
                {tsStop.isPending ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : (
                  <Square className="size-3.5 mr-1.5" />
                )}
                Stop
              </Button>
            )}
          </div>

          {!ts?.available && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertCircle className="size-3.5" />
              Tailscale not detected. Install it from{' '}
              <a
                href="https://tailscale.com/download"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                tailscale.com
              </a>
            </p>
          )}
        </div>
      </SettingsCard>

      {/* Cloudflare Card */}
      <SettingsCard
        title="Cloudflare Tunnel"
        description="Quick anonymous tunnel or persistent named tunnel with custom domain"
      >
        <div className="space-y-4">
          {/* Status row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Cloud className="size-4 text-muted-foreground" />
              <StatusBadge available={cf?.available ?? false} active={cf?.running ?? false} />
              {cf?.name && (
                <span className="text-xs text-muted-foreground">{cf.name}</span>
              )}
            </div>
          </div>

          {/* Active URL */}
          {cf?.url && cf.running && <CopyUrlButton url={cf.url} />}

          {/* Quick tunnel */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => cfQuick.mutate()}
              disabled={anyMutating || cf?.running}
              className={cn(!cf?.available && 'opacity-50 pointer-events-none')}
            >
              {cfQuick.isPending ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <Play className="size-3.5 mr-1.5" />
              )}
              Quick Tunnel
            </Button>
            <span className="text-xs text-muted-foreground">One-click via trycloudflare.com</span>
          </div>

          {/* Named tunnel form */}
          <div className="space-y-2 pt-1 border-t border-border/50">
            <p className="text-xs font-medium text-muted-foreground">Named Tunnel</p>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="tunnel-name"
                value={cfName}
                onChange={(e) => setCfName(e.target.value)}
                className="h-8 text-sm w-40"
                disabled={anyMutating || cf?.running}
              />
              <Input
                placeholder="example.com (optional)"
                value={cfDomain}
                onChange={(e) => setCfDomain(e.target.value)}
                className="h-8 text-sm w-48"
                disabled={anyMutating || cf?.running}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => cfNamed.mutate()}
                disabled={anyMutating || cf?.running || !cfName}
                className={cn(!cf?.available && 'opacity-50 pointer-events-none')}
              >
                {cfNamed.isPending ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : (
                  <Play className="size-3.5 mr-1.5" />
                )}
                Start Named
              </Button>
            </div>
          </div>

          {/* Stop button */}
          {cf?.running && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => cfStop.mutate()}
              disabled={anyMutating}
            >
              {cfStop.isPending ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <Square className="size-3.5 mr-1.5" />
              )}
              Stop Cloudflare Tunnel
            </Button>
          )}

          {!cf?.available && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertCircle className="size-3.5" />
              cloudflared not detected. Install from{' '}
              <a
                href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Cloudflare Docs
              </a>
            </p>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}
