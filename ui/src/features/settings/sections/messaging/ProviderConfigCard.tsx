/**
 * Generic Provider Config Card
 *
 * Renders a configuration form from a ProviderDefinition schema.
 * Used for the 15 providers that don't have custom rich config UIs.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  Send,
  Unlink,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getProviderLogo } from '@/components/shared/ProviderLogos';
import { API_BASE } from '../../constants.js';
import { TunnelSetupBanner } from '@/features/messaging/components/TunnelSetupBanner.js';
import type { ProviderDefinition, ProviderField } from './providers.js';

interface ProviderConfigCardProps {
  provider: ProviderDefinition;
  onBack: () => void;
}

interface ProviderStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
}

export function ProviderConfigCard({ provider, onBack }: ProviderConfigCardProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Record<string, string | boolean>>({});
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [testMessage, setTestMessage] = useState('Hello from profClaw!');
  const [testTarget, setTestTarget] = useState('');

  const { data: status, isLoading } = useQuery<ProviderStatus>({
    queryKey: [`${provider.id}-status`],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/messaging/${provider.id}/status`, { credentials: 'include' });
      if (!res.ok) return { configured: false, connected: false };
      return res.json();
    },
    staleTime: 30000,
  });

  const saveMutation = useMutation({
    mutationFn: async (config: Record<string, string | boolean>) => {
      const res = await fetch(`${API_BASE}/api/messaging/${provider.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to save' }));
        throw new Error(err.error || 'Failed to save configuration');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(`${provider.name} configuration saved`);
      queryClient.invalidateQueries({ queryKey: [`${provider.id}-status`] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/messaging/${provider.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ target: testTarget, message: testMessage }),
      });
      if (!res.ok) throw new Error('Test message failed');
      return res.json();
    },
    onSuccess: () => toast.success('Test message sent'),
    onError: () => toast.error('Failed to send test message'),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/messaging/${provider.id}/disconnect`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },
    onSuccess: () => {
      toast.success(`${provider.name} disconnected`);
      queryClient.invalidateQueries({ queryKey: [`${provider.id}-status`] });
      setFormData({});
    },
    onError: () => toast.error('Failed to disconnect'),
  });

  const togglePasswordVisibility = (key: string) => {
    setVisiblePasswords(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateField = (key: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    // Check required fields
    for (const field of provider.fields) {
      if (field.required && !formData[field.key]) {
        toast.error(`${field.label} is required`);
        return;
      }
    }
    saveMutation.mutate(formData);
  };

  const isWebChat = provider.id === 'webchat';
  const Logo = getProviderLogo(provider.id);

  return (
    <div className="space-y-5">
      {/* Back Navigation */}
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2">
        <ArrowLeft className="h-4 w-4" /> All Providers
      </Button>

      {/* Header */}
      <div className="relative overflow-hidden rounded-xl border" style={{ borderColor: `${provider.color}33` }}>
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{ background: `linear-gradient(135deg, ${provider.color}, transparent)` }}
        />
        <div className="relative p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="h-12 w-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${provider.color}15` }}
              >
                <Logo className="h-6 w-6" style={{ color: provider.color }} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-lg">{provider.name}</h3>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : status?.connected ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="h-3 w-3" /> Connected
                    </span>
                  ) : status?.configured ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="h-3 w-3" /> Configured
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      <XCircle className="h-3 w-3" /> Not configured
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{provider.description}</p>
              </div>
            </div>
            {provider.docsUrl && (
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Docs
                </a>
              </Button>
            )}
          </div>
          {/* Prerequisite hint */}
          {!status?.configured && provider.prerequisite && (
            <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              <Info className="h-4 w-4 shrink-0" />
              {provider.prerequisite}
            </div>
          )}
        </div>
      </div>

      {/* Tunnel setup for webhook providers */}
      {provider.requiresWebhook && (
        <TunnelSetupBanner
          webhookPath={provider.webhookPath}
          providerColor={provider.color}
        />
      )}

      {/* WebChat special case */}
      {isWebChat ? (
        <div className="rounded-xl border p-6 text-center text-muted-foreground">
          <p className="text-sm">WebChat is built-in and requires no configuration.</p>
          <p className="text-xs mt-1">It is always available at your profClaw instance URL.</p>
        </div>
      ) : (
        <>
          {/* Config Form */}
          <div className="rounded-xl border p-5 space-y-5">
            <h4 className="text-sm font-semibold">Configuration</h4>
            <div className="space-y-4">
              {provider.fields.map((field) => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={formData[field.key]}
                  passwordVisible={visiblePasswords.has(field.key)}
                  onTogglePassword={() => togglePasswordVisibility(field.key)}
                  onChange={(val) => updateField(field.key, val)}
                />
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                style={{ backgroundColor: provider.color }}
                className="text-white"
              >
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {status?.configured ? 'Update' : 'Connect'}
              </Button>
              {status?.configured && (
                <Button
                  variant="destructive"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                >
                  {disconnectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Unlink className="h-4 w-4 mr-1" /> Disconnect
                </Button>
              )}
            </div>
          </div>

          {/* Test Message */}
          {status?.connected && (
            <div className="rounded-xl border p-5 space-y-4">
              <h4 className="text-sm font-semibold">Test Message</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Target (chat ID / channel)</Label>
                  <Input
                    value={testTarget}
                    onChange={(e) => setTestTarget(e.target.value)}
                    placeholder="Chat ID or channel name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Message</Label>
                  <Input
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                  />
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !testTarget}
              >
                {testMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                Send Test
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  passwordVisible,
  onTogglePassword,
  onChange,
}: {
  field: ProviderField;
  value: string | boolean | undefined;
  passwordVisible: boolean;
  onTogglePassword: () => void;
  onChange: (val: string | boolean) => void;
}) {
  if (field.type === 'toggle') {
    return (
      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <div>
          <Label className="text-sm font-medium">{field.label}</Label>
          {field.helpText && <p className="text-xs text-muted-foreground mt-0.5">{field.helpText}</p>}
        </div>
        <Switch
          checked={!!value}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">{field.label} {field.required && <span className="text-destructive">*</span>}</Label>
        {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
        <Textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className="font-mono text-xs"
        />
      </div>
    );
  }

  const isPassword = field.type === 'password';
  const inputType = isPassword && !passwordVisible ? 'password' : 'text';

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{field.label} {field.required && <span className="text-destructive">*</span>}</Label>
      {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
      <div className="relative">
        <Input
          type={inputType}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={cn(isPassword && 'pr-10 font-mono')}
        />
        {isPassword && (
          <button
            type="button"
            onClick={onTogglePassword}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
