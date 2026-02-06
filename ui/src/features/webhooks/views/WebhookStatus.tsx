import { useState } from 'react';
import { useIntegrationsStatus } from '../api/webhooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusIndicator } from '@/components/shared/StatusIndicator';
import { CodeBlock, InlineCode } from '@/components/ui/code-block';
import {
  Github,
  ExternalLink,
  Copy,
  Check,
  Webhook,
  Link2,
  Terminal,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Icon mapping for integrations
const IntegrationIcons: Record<string, React.ElementType> = {
  github: Github,
  jira: () => (
    <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor">
      <path d="M11.75 0a11.75 11.75 0 1 0 0 23.5 11.75 11.75 0 0 0 0-23.5zM3.29 12.94l7.63-7.63a.65.65 0 0 1 .94 0l.47.47-6.2 6.2a.65.65 0 0 0 0 .94l.94.94a.65.65 0 0 0 .94 0l6.2-6.2.47.47a.65.65 0 0 1 0 .94l-7.63 7.63a1.29 1.29 0 0 1-1.88 0l-1.88-1.88a1.29 1.29 0 0 1 0-1.88z"/>
    </svg>
  ),
  linear: () => (
    <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor">
      <path d="M3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12ZM12 1C5.92487 1 1 5.92487 1 12C1 18.0751 5.92487 23 12 23C18.0751 23 23 18.0751 23 12C23 5.92487 18.0751 1 12 1ZM7 12L12 7V10.5H17V13.5H12V17L7 12Z"/>
    </svg>
  ),
};

const IntegrationColors: Record<string, string> = {
  github: 'from-gray-700 to-gray-900',
  jira: 'from-blue-600 to-blue-800',
  linear: 'from-indigo-500 to-indigo-600',
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(`${label} copied to clipboard`);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 rounded-lg"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function IntegrationCard({
  name,
  icon,
  description,
  configured,
  webhookUrl,
  oauthUrl,
}: {
  name: string;
  icon: string;
  description: string;
  configured: boolean;
  webhookUrl: string;
  oauthUrl: string;
}) {
  const Icon = IntegrationIcons[icon] || Webhook;
  const gradient = IntegrationColors[icon] || 'from-gray-500 to-gray-700';

  return (
    <Card className="glass rounded-[24px] overflow-hidden border-white/5 group hover-lift transition-liquid">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br shadow-lg",
              gradient
            )}>
              <div className="h-5 w-5 text-white">
                <Icon />
              </div>
            </div>
            <div>
              <CardTitle className="text-base font-bold">{name}</CardTitle>
              <p className="text-[11px] text-muted-foreground">{description}</p>
            </div>
          </div>
          <StatusIndicator
            status={configured ? 'online' : 'offline'}
            label={configured ? 'CONFIGURED' : 'NOT SET'}
            showLabel
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Webhook URL */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Webhook className="h-3 w-3" />
            Webhook URL
          </label>
          <div className="flex items-center gap-2 p-2.5 rounded-xl glass-heavy border border-white/5">
            <code className="flex-1 text-[11px] text-muted-foreground truncate font-mono">
              {webhookUrl}
            </code>
            <CopyButton text={webhookUrl} label="Webhook URL" />
          </div>
        </div>

        {/* OAuth Connect */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            OAuth Connect
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-xl text-[11px] font-bold"
            onClick={() => window.open(oauthUrl, '_blank')}
            disabled={!configured}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            {configured ? 'Connect' : 'Setup Required'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HookEndpointCard({
  name,
  endpoint,
  description,
}: {
  name: string;
  endpoint: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl glass-heavy border border-white/5">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg glass flex items-center justify-center">
          <Terminal className="h-4 w-4 text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-bold">{name}</p>
          <p className="text-[10px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <code className="text-[10px] text-muted-foreground font-mono px-2 py-1 rounded-lg bg-black/20 max-w-[200px] truncate">
          {endpoint}
        </code>
        <CopyButton text={endpoint} label="Endpoint" />
      </div>
    </div>
  );
}

export function WebhookStatus() {
  const { data, isLoading, error } = useIntegrationsStatus();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <header>
          <h2 className="text-2xl font-bold tracking-tight">Integrations</h2>
          <p className="text-muted-foreground text-sm">Loading webhook status...</p>
        </header>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-[24px] skeleton-glass" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <header>
          <h2 className="text-2xl font-bold tracking-tight">Integrations</h2>
          <p className="text-muted-foreground text-sm">Webhook and OAuth configuration</p>
        </header>
        <Card className="glass rounded-[28px] border-red-500/10">
          <CardContent className="p-8 text-center">
            <p className="text-red-400">Failed to load integration status</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const integrations = data?.integrations ?? {};
  const hookEndpoints = data?.hookEndpoints;
  const configuredCount = Object.values(integrations).filter(i => i.configured).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Integrations</h2>
          <p className="text-muted-foreground text-sm">
            Webhook and OAuth configuration for external services.
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full glass border-white/10">
          <Link2 className="h-4 w-4 text-blue-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest">
            {configuredCount}/{Object.keys(integrations).length} Connected
          </span>
        </div>
      </header>

      {/* Integration Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Object.entries(integrations).map(([key, integration]) => (
          <IntegrationCard
            key={key}
            name={integration.name}
            icon={integration.icon}
            description={integration.description}
            configured={integration.configured}
            webhookUrl={integration.webhookUrl}
            oauthUrl={integration.oauthUrl}
          />
        ))}
      </div>

      {/* Claude Code Hooks Section */}
      <Card className="glass rounded-[28px] border-white/5">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-orange-500 to-red-600 shadow-lg">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold">Claude Code Hooks</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Zero-token activity tracking endpoints
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {hookEndpoints && (
            <>
              <HookEndpointCard
                name="Tool Use Hook"
                endpoint={hookEndpoints.toolUse}
                description="POST after each tool call"
              />
              <HookEndpointCard
                name="Session End Hook"
                endpoint={hookEndpoints.sessionEnd}
                description="POST when session completes"
              />
              <HookEndpointCard
                name="Prompt Submit Hook"
                endpoint={hookEndpoints.promptSubmit}
                description="POST on user prompt"
              />
            </>
          )}

          {/* Setup Instructions */}
          <div className="mt-4 p-4 rounded-2xl bg-muted/50 border border-border">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Quick Setup
            </p>
            <p className="text-[12px] text-muted-foreground mb-3">
              Add this to your <InlineCode>~/.claude/settings.json</InlineCode>:
            </p>
            <CodeBlock filename="~/.claude/settings.json" language="json">
{`{
  "hooks": {
    "PostToolUse": "curl -X POST ${hookEndpoints?.toolUse || 'http://localhost:3000/api/hook/tool-use'}",
    "Stop": "curl -X POST ${hookEndpoints?.sessionEnd || 'http://localhost:3000/api/hook/session-end'}"
  }
}`}
            </CodeBlock>
          </div>
        </CardContent>
      </Card>

      {/* Help Text */}
      <Card className="glass rounded-[24px] border-white/5">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-xl glass-heavy flex items-center justify-center flex-shrink-0">
              <Badge variant="secondary" className="text-[10px] px-2 py-0.5">?</Badge>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-bold">How to configure integrations</p>
              <ol className="text-[12px] text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Set the required environment variables (CLIENT_ID and CLIENT_SECRET)</li>
                <li>Copy the webhook URL and add it to your service's webhook settings</li>
                <li>Use the OAuth connect button to authenticate your account</li>
                <li>Tasks will automatically be created from issues and tickets</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
