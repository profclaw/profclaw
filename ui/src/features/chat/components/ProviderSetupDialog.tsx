/**
 * Provider Setup Dialog Component
 *
 * Quick setup for popular AI providers with link to full settings.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Provider, ProviderInfo } from '../types';
import {
  AnthropicLogo,
  OpenAILogo,
  AzureLogo,
  GoogleLogo,
  GroqLogo,
  XAILogo,
  DeepSeekLogo,
  OpenRouterLogo,
  OllamaLogo,
} from '@/components/shared/ProviderLogos';

// Top providers for quick setup (most popular/useful)
const QUICK_PROVIDERS: ProviderInfo[] = [
  {
    type: 'anthropic',
    name: 'Anthropic',
    description: 'Claude Opus, Sonnet, Haiku',
    Logo: AnthropicLogo,
    setupUrl: 'https://console.anthropic.com/settings/keys',
    envVar: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-...',
    status: 'stable',
  },
  {
    type: 'openai',
    name: 'OpenAI',
    description: 'GPT-4.5, o1, o3-mini',
    Logo: OpenAILogo,
    setupUrl: 'https://platform.openai.com/api-keys',
    envVar: 'OPENAI_API_KEY',
    placeholder: 'sk-...',
    status: 'stable',
  },
  {
    type: 'azure',
    name: 'Azure OpenAI',
    description: 'Enterprise GPT-4, GPT-4o',
    Logo: AzureLogo,
    setupUrl: 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI',
    envVar: 'AZURE_OPENAI_API_KEY',
    placeholder: 'Enter API key...',
    status: 'stable',
  },
  {
    type: 'google',
    name: 'Google AI',
    description: 'Gemini 2.5 Pro, Flash',
    Logo: GoogleLogo,
    setupUrl: 'https://makersuite.google.com/app/apikey',
    envVar: 'GOOGLE_API_KEY',
    placeholder: 'AIza...',
    status: 'stable',
  },
  {
    type: 'xai',
    name: 'xAI (Grok)',
    description: 'Grok 2, Grok 3',
    Logo: XAILogo,
    setupUrl: 'https://console.x.ai/',
    envVar: 'XAI_API_KEY',
    placeholder: 'xai-...',
    status: 'beta',
  },
  {
    type: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference',
    Logo: GroqLogo,
    setupUrl: 'https://console.groq.com/keys',
    envVar: 'GROQ_API_KEY',
    placeholder: 'gsk_...',
    status: 'stable',
  },
  {
    type: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek R1, Chat, Coder',
    Logo: DeepSeekLogo,
    setupUrl: 'https://platform.deepseek.com/api_keys',
    envVar: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-...',
    status: 'beta',
  },
  {
    type: 'openrouter',
    name: 'OpenRouter',
    description: '300+ models, one API',
    Logo: OpenRouterLogo,
    setupUrl: 'https://openrouter.ai/keys',
    envVar: 'OPENROUTER_API_KEY',
    placeholder: 'sk-or-...',
    status: 'stable',
  },
  {
    type: 'ollama',
    name: 'Ollama',
    description: 'Local models, free',
    Logo: OllamaLogo,
    setupUrl: 'https://ollama.ai/download',
    envVar: 'OLLAMA_BASE_URL',
    placeholder: 'http://localhost:11434',
    status: 'stable',
  },
];

interface ProviderSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: Provider[];
  onSaveApiKey: (type: string, apiKey: string) => Promise<void>;
}

export function ProviderSetupDialog({
  open,
  onOpenChange,
  providers,
  onSaveApiKey,
}: ProviderSetupDialogProps) {
  const navigate = useNavigate();
  const [apiKeyInput, setApiKeyInput] = useState<Record<string, string>>({});
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const healthyProviders = providers.filter((p) => p.healthy);
  const connectedCount = healthyProviders.length;

  const handleSaveApiKey = async (providerType: string) => {
    const apiKey = apiKeyInput[providerType];
    if (!apiKey) return;

    setSavingProvider(providerType);
    try {
      await onSaveApiKey(providerType, apiKey);
      setApiKeyInput((prev) => ({ ...prev, [providerType]: '' }));
      setExpandedProvider(null);
    } finally {
      setSavingProvider(null);
    }
  };

  const handleManageAll = () => {
    onOpenChange(false);
    navigate('/settings/ai-providers');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 bg-gradient-to-b from-primary/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg">Connect AI Providers</DialogTitle>
              <DialogDescription className="text-sm">
                {connectedCount > 0 ? (
                  <span className="text-green-500">{connectedCount} connected</span>
                ) : (
                  'Add API keys to get started'
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Provider Grid */}
        <div className="px-6 pb-4">
          <div className="grid grid-cols-2 gap-2">
            {QUICK_PROVIDERS.map((info) => {
              const provider = providers.find((p) => p.type === info.type);
              const isHealthy = provider?.healthy;
              const isExpanded = expandedProvider === info.type;

              return (
                <div
                  key={info.type}
                  className={cn(
                    'relative rounded-xl border transition-all cursor-pointer',
                    isHealthy
                      ? 'border-green-500/40 bg-green-500/5'
                      : 'border-border hover:border-primary/30 hover:bg-muted/30',
                    isExpanded && 'col-span-2 bg-muted/50'
                  )}
                >
                  {/* Provider Card */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Configure ${info.name}`}
                    aria-expanded={isExpanded}
                    className="flex items-center gap-3 p-3 focus-visible:ring-2 focus-visible:ring-primary outline-none"
                    onClick={() => setExpandedProvider(isExpanded ? null : info.type)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedProvider(isExpanded ? null : info.type);
                      }
                    }}
                  >
                    <div className={cn(
                      'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
                      isHealthy ? 'bg-green-500/10' : 'bg-muted'
                    )}>
                      <info.Logo className={cn('h-5 w-5', isHealthy && 'text-green-600')} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{info.name}</span>
                        {info.status === 'beta' && (
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 uppercase tracking-wide shrink-0">
                            Beta
                          </span>
                        )}
                        {info.status === 'experimental' && (
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 uppercase tracking-wide shrink-0">
                            Exp
                          </span>
                        )}
                        {isHealthy && (
                          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" aria-hidden="true" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{info.description}</p>
                    </div>
                  </div>

                  {/* Expanded Input */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-border/50">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showApiKey[info.type] ? 'text' : 'password'}
                            placeholder={info.placeholder}
                            value={apiKeyInput[info.type] || ''}
                            onChange={(e) =>
                              setApiKeyInput((prev) => ({
                                ...prev,
                                [info.type]: e.target.value,
                              }))
                            }
                            onClick={(e) => e.stopPropagation()}
                            className="w-full field pr-9"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowApiKey((prev) => ({
                                ...prev,
                                [info.type]: !prev[info.type],
                              }));
                            }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label={showApiKey[info.type] ? 'Hide API key' : 'Show API key'}
                          >
                            {showApiKey[info.type] ? (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveApiKey(info.type);
                          }}
                          disabled={!apiKeyInput[info.type] || savingProvider === info.type}
                          className="px-3"
                        >
                          {savingProvider === info.type ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Save'
                          )}
                        </Button>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <a
                          href={info.setupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          Get API Key
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        {info.type === 'ollama' && (
                          <span className="text-xs text-muted-foreground">
                            Run: <code className="bg-muted px-1 rounded">ollama serve</code>
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-muted/30 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleManageAll}
            className="text-muted-foreground hover:text-foreground gap-2"
          >
            <Settings2 className="h-4 w-4" />
            Manage All Providers
          </Button>
          <Button onClick={() => onOpenChange(false)} size="sm">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
