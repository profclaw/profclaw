/**
 * OOBE (Out-of-Box Experience) Wizard
 *
 * Full-screen setup wizard with Quick and Guided paths.
 * Quick: Name -> AI Provider -> Done (2-3 steps)
 * Guided: Name -> AI Provider -> GitHub -> Security -> Done
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import {
  Zap,
  Compass,
  ChevronRight,
  ChevronLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  Github,
  Shield,
  Sun,
  Moon,
  Eclipse,
  ExternalLink,
} from 'lucide-react';
import { WaveBackground } from '../components/WaveBackground';
import {
  AnthropicLogo,
  OpenAILogo,
  GoogleLogo,
  AzureLogo,
  GroqLogo,
  OpenRouterLogo,
  OllamaLogo,
  XAILogo,
  PerplexityLogo,
  MistralLogo,
  CohereLogo,
  DeepSeekLogo,
  TogetherLogo,
  CerebrasLogo,
  FireworksLogo,
  CopilotLogo,
} from '@/components/shared/ProviderLogos';

// =============================================================================
// TYPES & DATA
// =============================================================================

type SetupPath = 'quick' | 'guided';

type AIProviderType =
  | 'anthropic' | 'openai' | 'google' | 'azure' | 'ollama' | 'openrouter'
  | 'groq' | 'xai' | 'mistral' | 'cohere' | 'perplexity' | 'deepseek'
  | 'together' | 'cerebras' | 'fireworks' | 'copilot';

interface ProviderEntry {
  id: AIProviderType;
  name: string;
  desc: string;
  color: string;
  Logo: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  needsUrl?: boolean;
  keyPlaceholder?: string;
  keyUrl?: string;
}

const POPULAR_COUNT = 8;

const AI_PROVIDERS: ProviderEntry[] = [
  // Popular (top 8 shown by default)
  { id: 'anthropic', name: 'Anthropic', desc: 'Claude', color: '#cc785c', Logo: AnthropicLogo, keyPlaceholder: 'sk-ant-...', keyUrl: 'https://console.anthropic.com/' },
  { id: 'openai', name: 'OpenAI', desc: 'GPT & o-series', color: '#10a37f', Logo: OpenAILogo, keyPlaceholder: 'sk-...', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'google', name: 'Google', desc: 'Gemini', color: '#4285F4', Logo: GoogleLogo, keyPlaceholder: 'AIza...', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', name: 'Groq', desc: 'Ultra-fast', color: '#f55036', Logo: GroqLogo, keyPlaceholder: 'gsk_...', keyUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', name: 'OpenRouter', desc: 'Multi-provider', color: '#6366f1', Logo: OpenRouterLogo, keyPlaceholder: 'sk-or-...', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'xai', name: 'xAI', desc: 'Grok', color: '#1d9bf0', Logo: XAILogo, keyPlaceholder: 'xai-...', keyUrl: 'https://console.x.ai/' },
  { id: 'deepseek', name: 'DeepSeek', desc: 'R1 & V3', color: '#4d6bfe', Logo: DeepSeekLogo, keyPlaceholder: 'sk-...', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'ollama', name: 'Ollama', desc: 'Local models', color: '#808080', Logo: OllamaLogo, needsUrl: true, keyUrl: 'https://ollama.com/' },
  // More providers (hidden by default)
  { id: 'mistral', name: 'Mistral', desc: 'Mixtral', color: '#ee792f', Logo: MistralLogo, keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'azure', name: 'Azure', desc: 'Azure OpenAI', color: '#00abec', Logo: AzureLogo, keyUrl: 'https://portal.azure.com/' },
  { id: 'perplexity', name: 'Perplexity', desc: 'Online LLMs', color: '#20808d', Logo: PerplexityLogo, keyPlaceholder: 'pplx-...', keyUrl: 'https://www.perplexity.ai/settings/api' },
  { id: 'together', name: 'Together', desc: 'Open-source', color: '#6366f1', Logo: TogetherLogo, keyUrl: 'https://api.together.xyz/settings/api-keys' },
  { id: 'cohere', name: 'Cohere', desc: 'Command', color: '#39594d', Logo: CohereLogo, keyUrl: 'https://dashboard.cohere.com/api-keys' },
  { id: 'fireworks', name: 'Fireworks', desc: 'Fast inference', color: '#ff6b35', Logo: FireworksLogo, keyPlaceholder: 'fw_...', keyUrl: 'https://fireworks.ai/api-keys' },
  { id: 'cerebras', name: 'Cerebras', desc: 'Wafer-scale', color: '#f15a29', Logo: CerebrasLogo, keyPlaceholder: 'csk-...', keyUrl: 'https://cloud.cerebras.ai/' },
  { id: 'copilot', name: 'Copilot', desc: 'GitHub proxy', color: '#6e40c9', Logo: CopilotLogo, keyUrl: 'https://github.com/settings/copilot' },
];

interface SetupData {
  name: string;
  avatarUrl?: string;
  aiProvider?: {
    provider: AIProviderType;
    apiKey?: string;
    ollamaBaseUrl?: string;
  };
  github?: {
    clientId: string;
    clientSecret: string;
  };
  multiUser?: {
    email: string;
    password: string;
  };
}

// =============================================================================
// STEP COMPONENTS
// =============================================================================

function WelcomeStep({
  data,
  onUpdate,
  path,
  onPathChange,
}: {
  data: SetupData;
  onUpdate: (d: Partial<SetupData>) => void;
  path: SetupPath;
  onPathChange: (p: SetupPath) => void;
}) {
  const { resolvedTheme } = useTheme();
  const wordmarkSrc = resolvedTheme === 'light'
    ? '/brand/profclaw-wordmark-light.svg'
    : '/brand/profclaw-wordmark-dark.svg';

  return (
    <div style={{ animation: 'oobe-fade-in 0.5s ease-out' }}>
      <div className="grid md:grid-cols-2 gap-10 items-center">
        {/* Left: Brand + greeting */}
        <div className="space-y-4 text-center md:text-left">
          <img
            src={wordmarkSrc}
            alt="profClaw"
            className="h-20 mx-auto md:mx-0 drop-shadow-lg"
          />
          <h2 className="text-2xl font-bold tracking-tight font-heading heading-brand-glow">
            Welcome to profClaw
          </h2>
          <p className="text-[var(--muted-foreground)] text-[15px] leading-relaxed">
            Your AI agent engine, running locally on your machine.
            <br />
            <span className="text-[var(--muted-foreground)]/70">Private. Fast. Yours.</span>
          </p>
        </div>

        {/* Right: Form */}
        <div className="space-y-6">
          {/* Name input */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              What should we call you?
            </label>
            <input
              type="text"
              className="field-lg w-full text-base"
              placeholder="Your name"
              value={data.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              autoFocus
            />
          </div>

          {/* Setup path selector */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Setup experience
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onPathChange('quick')}
                className={`group relative p-5 rounded-2xl text-left transition-all duration-300 ${
                  path === 'quick'
                    ? 'glass-heavy brand-ring shadow-elevated'
                    : 'glass hover:shadow-elevated hover:translate-y-[-2px]'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center mb-3 ${
                    path === 'quick'
                      ? 'bg-gradient-to-br from-[#f43f5e]/20 to-[#ea580c]/10'
                      : 'bg-[var(--muted)]/50'
                  }`}
                >
                  <Zap
                    className={`h-4 w-4 ${
                      path === 'quick'
                        ? 'text-[#f43f5e]'
                        : 'text-[var(--muted-foreground)]'
                    }`}
                  />
                </div>
                <div className="font-semibold text-sm">Quick Setup</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
                  2 steps. Name + AI key.
                </div>
              </button>
              <button
                type="button"
                onClick={() => onPathChange('guided')}
                className={`group relative p-5 rounded-2xl text-left transition-all duration-300 ${
                  path === 'guided'
                    ? 'glass-heavy brand-ring shadow-elevated'
                    : 'glass hover:shadow-elevated hover:translate-y-[-2px]'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center mb-3 ${
                    path === 'guided'
                      ? 'bg-gradient-to-br from-[#f43f5e]/20 to-[#ea580c]/10'
                      : 'bg-[var(--muted)]/50'
                  }`}
                >
                  <Compass
                    className={`h-4 w-4 ${
                      path === 'guided'
                        ? 'text-[#f43f5e]'
                        : 'text-[var(--muted-foreground)]'
                    }`}
                  />
                </div>
                <div className="font-semibold text-sm">Guided Setup</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
                  5 steps. GitHub, security.
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AIProviderStep({
  data,
  onUpdate,
  onSkip,
  name,
}: {
  data: SetupData;
  onUpdate: (d: Partial<SetupData>) => void;
  onSkip: () => void;
  name: string;
}) {
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const provider = data.aiProvider?.provider || 'anthropic';
  const apiKey = data.aiProvider?.apiKey || '';
  const ollamaBaseUrl = data.aiProvider?.ollamaBaseUrl || 'http://localhost:11434';

  const selectedProvider = AI_PROVIDERS.find((p) => p.id === provider);

  const setProvider = (p: AIProviderType) => {
    onUpdate({
      aiProvider: { provider: p, apiKey: '', ollamaBaseUrl: 'http://localhost:11434' },
    });
    setValidationResult(null);
    // Auto-expand if selecting a non-popular provider
    const idx = AI_PROVIDERS.findIndex((prov) => prov.id === p);
    if (idx >= POPULAR_COUNT) setShowAll(true);
  };

  const setApiKey = (key: string) => {
    onUpdate({ aiProvider: { ...data.aiProvider, provider, apiKey: key } });
    setValidationResult(null);
  };

  const setOllamaUrl = (url: string) => {
    onUpdate({ aiProvider: { provider: 'ollama', ollamaBaseUrl: url } });
    setValidationResult(null);
  };

  const validate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await fetch('/api/oobe/validate-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, ollamaBaseUrl }),
      });
      const result = await res.json();
      setValidationResult({
        valid: result.valid,
        message: result.valid ? result.message : result.error,
      });
    } catch {
      setValidationResult({ valid: false, message: 'Connection failed' });
    } finally {
      setValidating(false);
    }
  };

  return (
    <div style={{ animation: 'oobe-fade-in 0.5s ease-out' }}>
      <div className="space-y-1 mb-6">
        <h2 className="text-2xl font-bold tracking-tight font-heading heading-brand-glow">
          Nice to meet you, {name || 'friend'}!
        </h2>
        <p className="text-[var(--muted-foreground)] text-sm">
          Now let's pick an AI provider to power your agents. You can always change this later.
        </p>
      </div>

      {/* 2-column layout: providers left, config right */}
      <div className="grid md:grid-cols-[1fr,1fr] gap-6 items-start">
        {/* Left: Provider grid */}
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-2">
            {(showAll ? AI_PROVIDERS : AI_PROVIDERS.slice(0, POPULAR_COUNT)).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-all duration-200 ${
                  provider === p.id
                    ? 'glass-heavy'
                    : 'glass hover:shadow-soft hover:translate-y-[-1px]'
                }`}
                style={
                  provider === p.id
                    ? { boxShadow: `0 0 0 2px ${p.color}, 0 4px 16px ${p.color}25` }
                    : undefined
                }
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{
                    background:
                      provider === p.id
                        ? `${p.color}18`
                        : 'oklch(from var(--foreground) l c h / 0.05)',
                  }}
                >
                  <p.Logo
                    className="h-[18px] w-[18px]"
                    style={provider === p.id ? { color: p.color } : undefined}
                  />
                </div>
                <div>
                  <div className="font-semibold text-xs leading-tight">{p.name}</div>
                  <div className="text-[10px] text-[var(--muted-foreground)] leading-tight">
                    {p.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="w-full text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors py-1.5"
          >
            {showAll ? 'Show less' : `+${AI_PROVIDERS.length - POPULAR_COUNT} more providers`}
          </button>
        </div>

        {/* Right: Configuration panel */}
        <div className="space-y-4 glass rounded-2xl p-6">
          {/* Provider header with get-key link */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {selectedProvider && (
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: `${selectedProvider.color}18` }}
                >
                  <selectedProvider.Logo
                    className="h-4 w-4"
                    style={{ color: selectedProvider.color }}
                  />
                </div>
              )}
              <div>
                <div className="font-semibold text-sm">{selectedProvider?.name}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{selectedProvider?.desc}</div>
              </div>
            </div>
            {selectedProvider?.keyUrl && (
              <a
                href={selectedProvider.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                Get key <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Input */}
          {selectedProvider?.needsUrl ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Ollama URL</label>
              <input
                type="text"
                className="field-lg w-full"
                placeholder="http://localhost:11434"
                value={ollamaBaseUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  className="field-lg w-full pr-10"
                  placeholder={selectedProvider?.keyPlaceholder || 'Enter API key...'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Your key doesn't leave your device.
              </p>
            </div>
          )}

          {/* Test + Skip */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={validate}
              disabled={validating || (!selectedProvider?.needsUrl && !apiKey)}
              className="btn-brand-outline flex-1 py-2.5 px-4 text-sm font-medium disabled:opacity-40"
            >
              {validating ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Testing...
                </span>
              ) : (
                'Test Connection'
              )}
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="btn-ghost py-2.5 px-4 text-sm text-[var(--muted-foreground)]"
            >
              Skip for now
            </button>
          </div>

          {/* Validation result */}
          {validationResult && (
            <div
              className={`flex items-start gap-2 p-3 rounded-xl text-sm ${
                validationResult.valid
                  ? 'bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]'
                  : 'bg-[hsl(var(--destructive)/0.1)] text-[hsl(var(--destructive))]'
              }`}
            >
              {validationResult.valid ? (
                <Check className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <span>{validationResult.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GitHubOAuthStep({
  data,
  onUpdate,
  name,
}: {
  data: SetupData;
  onUpdate: (d: Partial<SetupData>) => void;
  name: string;
}) {
  const clientId = data.github?.clientId || '';
  const clientSecret = data.github?.clientSecret || '';
  const [showSecret, setShowSecret] = useState(false);

  return (
    <div
      className="space-y-6 max-w-lg mx-auto"
      style={{ animation: 'oobe-fade-in 0.5s ease-out' }}
    >
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight font-heading">
          Connect GitHub, {name || 'friend'}?
        </h2>
        <p className="text-[var(--muted-foreground)] text-sm">
          Optional. Enables GitHub login and repository access for your agents.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Client ID</label>
          <input
            type="text"
            className="field-lg w-full"
            placeholder="Your GitHub OAuth App Client ID"
            value={clientId}
            onChange={(e) =>
              onUpdate({ github: { clientId: e.target.value, clientSecret } })
            }
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Client Secret</label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              className="field-lg w-full pr-10"
              placeholder="Your GitHub OAuth App Client Secret"
              value={clientSecret}
              onChange={(e) =>
                onUpdate({ github: { clientId, clientSecret: e.target.value } })
              }
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--muted-foreground)] text-center">
        You can skip this and configure it later in Settings.
      </p>
    </div>
  );
}

function SecurityStep({
  data,
  onUpdate,
  name,
}: {
  data: SetupData;
  onUpdate: (d: Partial<SetupData>) => void;
  name: string;
}) {
  const [enableMulti, setEnableMulti] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const email = data.multiUser?.email || '';
  const password = data.multiUser?.password || '';

  return (
    <div
      className="space-y-6 max-w-lg mx-auto"
      style={{ animation: 'oobe-fade-in 0.5s ease-out' }}
    >
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight font-heading heading-brand-glow">
          Almost there, {name || 'friend'}!
        </h2>
        <p className="text-[var(--muted-foreground)] text-sm">
          By default, profClaw runs in single-user local mode - no login required. Want to share it?
        </p>
      </div>

      <button
        type="button"
        onClick={() => {
          setEnableMulti(!enableMulti);
          if (enableMulti) {
            onUpdate({ multiUser: undefined });
          }
        }}
        className={`w-full p-4 rounded-2xl text-left transition-all duration-300 ${
          enableMulti
            ? 'glass-heavy brand-ring'
            : 'glass hover:shadow-soft'
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm">Enable Multi-User Auth</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-1">
              Require login with email and password
            </div>
          </div>
          <div
            className={`w-10 h-6 rounded-full transition-colors duration-200 flex items-center ${
              enableMulti
                ? 'bg-[#e11d48] justify-end'
                : 'bg-[var(--muted)] justify-start'
            }`}
          >
            <div className="w-5 h-5 rounded-full bg-white mx-0.5 shadow-sm" />
          </div>
        </div>
      </button>

      {enableMulti && (
        <div className="space-y-4" style={{ animation: 'oobe-fade-in 0.3s ease-out' }}>
          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              className="field-lg w-full"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) =>
                onUpdate({ multiUser: { email: e.target.value, password } })
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className="field-lg w-full pr-10"
                placeholder="Min 8 characters"
                value={password}
                onChange={(e) =>
                  onUpdate({ multiUser: { email, password: e.target.value } })
                }
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompleteStep({ name }: { name: string }) {
  return (
    <div
      className="space-y-8 text-center py-6 max-w-lg mx-auto"
      style={{ animation: 'oobe-fade-in 0.5s ease-out' }}
    >
      {/* Animated success icon with brand glow */}
      <div className="relative mx-auto w-20 h-20">
        {/* Outer glow ring */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            animation: 'oobe-check 0.6s ease-out 0.1s both',
            background: 'linear-gradient(135deg, oklch(from #e11d48 l c h / 0.08), oklch(from #ea580c l c h / 0.05))',
            boxShadow: '0 0 40px oklch(from #e11d48 l c h / 0.15)',
          }}
        />
        {/* Inner icon */}
        <div
          className="absolute inset-2 rounded-full flex items-center justify-center"
          style={{
            animation: 'oobe-check 0.6s ease-out 0.3s both',
            background: 'linear-gradient(135deg, oklch(from #e11d48 l c h / 0.2), oklch(from #ea580c l c h / 0.12))',
          }}
        >
          <Check className="h-8 w-8 text-[#f43f5e]" strokeWidth={3} />
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight font-heading heading-brand-glow">
          You're all set, {name}!
        </h2>
        <p className="text-[var(--muted-foreground)] text-[15px] max-w-sm mx-auto leading-relaxed">
          profClaw is configured and ready to go. Your AI agents are standing by.
        </p>
      </div>

      {/* Quick feature highlights */}
      <div className="flex items-center justify-center gap-6 text-xs text-[var(--muted-foreground)]">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--success))]" />
          Local-first
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--success))]" />
          Private
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--success))]" />
          Ready
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// COMPACT THEME TOGGLE
// =============================================================================

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  const themes = [
    { id: 'light', icon: Sun, label: 'Light' },
    { id: 'dark', icon: Moon, label: 'Dark' },
    { id: 'midnight', icon: Eclipse, label: 'Midnight' },
  ];

  return (
    <div className="flex items-center gap-0.5 p-1 rounded-full glass">
      {themes.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTheme(id)}
          title={label}
          className={`p-1.5 rounded-full transition-all duration-200 ${
            theme === id
              ? 'bg-[var(--foreground)] text-[var(--background)] shadow-sm'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// STEP TRACKER
// =============================================================================

const STEP_LABELS: Record<string, string> = {
  welcome: 'Profile',
  'ai-provider': 'AI Provider',
  github: 'GitHub',
  security: 'Security',
  complete: 'Done',
};

function StepTracker({
  steps,
  current,
}: {
  steps: readonly string[];
  current: number;
}) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((stepId, i) => {
        const isActive = i === current;
        const isCompleted = i < current;
        const isLast = i === steps.length - 1;

        return (
          <div key={stepId} className="flex items-center">
            {/* Step pill */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all duration-300 ${
                isActive
                  ? 'bg-gradient-to-r from-[#e11d48]/15 to-[#ea580c]/10'
                  : isCompleted
                    ? 'opacity-60'
                    : 'opacity-30'
              }`}
            >
              {/* Step indicator */}
              <div
                className={`flex items-center justify-center rounded-full transition-all duration-300 ${
                  isActive
                    ? 'w-5 h-5 brand-dot'
                    : isCompleted
                      ? 'w-5 h-5 bg-[#e11d48]/40'
                      : 'w-5 h-5 border-2 border-[var(--muted-foreground)]/20'
                }`}
              >
                {isCompleted ? (
                  <Check className="h-3 w-3 text-white" strokeWidth={3} />
                ) : (
                  <span
                    className={`text-[10px] font-bold ${
                      isActive ? 'text-white' : 'text-[var(--muted-foreground)]/50'
                    }`}
                  >
                    {i + 1}
                  </span>
                )}
              </div>
              {/* Label */}
              <span
                className={`text-xs font-medium transition-all duration-300 ${
                  isActive
                    ? 'text-[var(--foreground)]'
                    : 'text-[var(--muted-foreground)]'
                }`}
              >
                {STEP_LABELS[stepId] || stepId}
              </span>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div
                className={`w-6 h-px mx-0.5 transition-colors duration-300 ${
                  isCompleted
                    ? 'bg-[#e11d48]/30'
                    : 'bg-[var(--muted-foreground)]/10'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// MAIN WIZARD
// =============================================================================

export function OOBEWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();

  const [path, setPath] = useState<SetupPath>('quick');
  const [step, setStep] = useState(0);
  const [data, setData] = useState<SetupData>({ name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateData = useCallback(
    (updates: Partial<SetupData>) => {
      setData((prev) => ({ ...prev, ...updates }));
      setError(null);
    },
    []
  );

  // handleSkipAI is defined after handleSubmit below

  // Step definitions based on path
  const steps =
    path === 'quick'
      ? ['welcome', 'ai-provider', 'complete'] as const
      : ['welcome', 'ai-provider', 'github', 'security', 'complete'] as const;

  const totalSteps = steps.length;
  const currentStepId = steps[step];
  const isLastContentStep = step === totalSteps - 2; // step before "complete"
  const isComplete = currentStepId === 'complete';

  const canGoNext = (): boolean => {
    switch (currentStepId) {
      case 'welcome':
        return data.name.trim().length > 0;
      case 'ai-provider':
        if (!data.aiProvider) return true; // optional
        if (data.aiProvider.provider === 'ollama') return true;
        return !!data.aiProvider.apiKey;
      case 'github':
        return true; // optional
      case 'security':
        if (data.multiUser) {
          return (
            data.multiUser.email.includes('@') &&
            data.multiUser.password.length >= 8
          );
        }
        return true;
      default:
        return true;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      // 1. Create local user + set AI provider
      const setupRes = await fetch('/api/oobe/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name.trim(),
          avatarUrl: data.avatarUrl,
          aiProvider: data.aiProvider,
        }),
      });

      if (!setupRes.ok) {
        const err = await setupRes.json();
        throw new Error(err.error || 'Setup failed');
      }

      // 2. Configure GitHub OAuth if provided (guided path)
      if (data.github?.clientId && data.github?.clientSecret) {
        await fetch('/api/setup/github-oauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            clientId: data.github.clientId,
            clientSecret: data.github.clientSecret,
          }),
        });
      }

      // 3. Enable multi-user if configured (guided path)
      if (data.multiUser?.email && data.multiUser?.password) {
        const multiRes = await fetch('/api/oobe/enable-multiuser', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: data.multiUser.email,
            password: data.multiUser.password,
          }),
        });

        if (!multiRes.ok) {
          const err = await multiRes.json();
          throw new Error(err.error || 'Failed to enable multi-user');
        }
      }

      // Move to complete step
      setStep(totalSteps - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = async () => {
    if (isLastContentStep) {
      await handleSubmit();
    } else {
      setStep((s) => Math.min(s + 1, totalSteps - 1));
    }
  };

  const handleSkipAI = async () => {
    setData((prev) => ({ ...prev, aiProvider: undefined }));
    if (isLastContentStep) {
      await handleSubmit();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleFinish = () => {
    // Hard reload to clear all cached state and let the server-side
    // auth middleware handle the fresh session cookie
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <WaveBackground />

      {/* Glass card - wide rectangular, Apple-like frosted glass */}
      <div
        className="relative z-10 w-full max-w-5xl min-h-[70vh] flex flex-col rounded-[3rem]"
        style={{
          animation: 'oobe-scale-in 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
          background: 'color-mix(in srgb, hsl(var(--card)), transparent 12%)',
          backdropFilter: 'blur(60px) saturate(200%)',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          border: 'none',
          boxShadow: [
            '0 0 0 1px oklch(1 0 0 / 0.06) inset',
            '0 1px 1px 0 oklch(1 0 0 / 0.1) inset',
            '0 24px 80px -12px oklch(0 0 0 / 0.25)',
            '0 8px 32px -8px oklch(from #e11d48 l c h / 0.08)',
          ].join(', '),
        }}
      >
        {/* Top frosted bar with progress dots + theme toggle */}
        <div
          className="flex items-center justify-between px-8 py-5 rounded-t-[3rem]"
          style={{
            borderBottom: '1px solid oklch(1 0 0 / 0.06)',
          }}
        >
          {/* Left spacer */}
          <div className="w-24" />
          {/* Center: step tracker */}
          {!isComplete ? (
            <StepTracker steps={steps} current={step} />
          ) : (
            <div />
          )}
          {/* Right: theme toggle */}
          <div className="w-24 flex justify-end">
            <ThemeSwitch />
          </div>
        </div>

        {/* Step content - generous padding, full width */}
        <div className="flex-1 flex flex-col justify-center px-12 py-8 w-full">
          {currentStepId === 'welcome' && (
            <WelcomeStep
              data={data}
              onUpdate={updateData}
              path={path}
              onPathChange={setPath}
            />
          )}
          {currentStepId === 'ai-provider' && (
            <AIProviderStep data={data} onUpdate={updateData} onSkip={handleSkipAI} name={data.name.trim()} />
          )}
          {currentStepId === 'github' && (
            <GitHubOAuthStep data={data} onUpdate={updateData} name={data.name.trim()} />
          )}
          {currentStepId === 'security' && (
            <SecurityStep data={data} onUpdate={updateData} name={data.name.trim()} />
          )}
          {currentStepId === 'complete' && (
            <CompleteStep name={data.name} />
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-[hsl(var(--destructive)/0.1)] text-[hsl(var(--destructive))] text-sm max-w-lg mx-auto w-full px-12">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Bottom nav bar */}
        <div
          className="flex items-center justify-between px-12 py-6 rounded-b-[3rem]"
          style={{ borderTop: '1px solid oklch(1 0 0 / 0.06)' }}
        >
          {/* Left: back button or spacer */}
          {step > 0 && !isComplete ? (
            <button
              type="button"
              onClick={handleBack}
              className="btn-ghost py-2.5 px-4 text-sm flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
          ) : (
            <div className="w-24" />
          )}

          {/* Right: action button */}
          {isComplete ? (
            <button
              type="button"
              onClick={handleFinish}
              className="btn-brand py-2.5 px-8 text-sm flex items-center gap-2"
            >
              Go to Dashboard <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              disabled={!canGoNext() || submitting}
              className="btn-brand py-2.5 px-8 text-sm flex items-center gap-2 disabled:opacity-40"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Setting up...
                </>
              ) : isLastContentStep ? (
                <>
                  Complete Setup <Check className="h-4 w-4" />
                </>
              ) : (
                <>
                  Continue <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
