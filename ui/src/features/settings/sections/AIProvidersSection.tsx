/**
 * AI Providers Section
 *
 * Configure connections to AI providers including cloud, enterprise, and local options.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Terminal,
  Github,
  Info,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/core/api/client';
import { SettingsCard } from '../components';
import {
  AI_PROVIDERS,
  AZURE_API_VERSIONS,
  validateAzureEndpoint,
  type AIProviderConfig,
} from '../constants';

export function AIProvidersSection() {
  const queryClient = useQueryClient();
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [baseUrlInputs, setBaseUrlInputs] = useState<Record<string, string>>({});
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({});
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  // Azure-specific fields
  const [azureDeploymentName, setAzureDeploymentName] = useState('');
  const [azureApiVersion, setAzureApiVersion] = useState(AZURE_API_VERSIONS[0].value);
  const [azureValidation, setAzureValidation] = useState<{
    endpoint?: string;
  }>({});

  const {
    data: providersData,
    refetch: refetchProviders,
    isRefetching,
  } = useQuery({
    queryKey: ['chat', 'providers'],
    queryFn: () => api.chat.providers(),
    refetchInterval: 30000,
    staleTime: 25000, // Prevent duplicate fetches when multiple components use same query
  });

  // Note: Provider config (baseUrl, defaultModel) is stored on the backend
  // but not returned in the providers list response. Configuration is persisted
  // when the user clicks Save and restored by the backend when making API calls.

  const configureProvider = useMutation({
    mutationFn: ({
      type,
      apiKey,
      baseUrl,
      defaultModel,
      apiVersion,
    }: {
      type: string;
      apiKey?: string;
      baseUrl?: string;
      defaultModel?: string;
      apiVersion?: string;
    }) =>
      api.chat.configure(type, {
        apiKey,
        baseUrl,
        defaultModel,
        apiVersion,
        enabled: true,
      }),
    onSuccess: (_data, variables) => {
      toast.success(`${variables.type} configured`);
      refetchProviders();
      queryClient.invalidateQueries({ queryKey: ['chat', 'providers'] });
      // Don't clear API key - keep it visible so user can test connection
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed'),
  });

  const testProvider = useMutation({
    mutationFn: async (type: string) => {
      const response = await fetch(
        `http://localhost:3000/api/chat/providers/${type}/health`,
        { method: 'POST' }
      );
      if (!response.ok) throw new Error('Health check failed');
      return response.json();
    },
    onSuccess: (data) => {
      if (data.healthy) {
        toast.success(`Connection successful (${data.latencyMs}ms)`);
      } else {
        toast.error(data.message || 'Connection failed');
      }
      refetchProviders();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Test failed'),
  });

  const providers = providersData?.providers || [];
  const healthyCount = providers.filter((p) => p.healthy).length;

  const handleSave = async (type: string) => {
    const config = AI_PROVIDERS.find((p) => p.type === type);
    if (!config) return;
    setSavingProvider(type);
    try {
      // For Azure, use deployment name as the model
      const defaultModel = type === 'azure' ? azureDeploymentName : modelInputs[type];

      // For Azure, ensure the endpoint has /openai suffix for Cognitive Services endpoints
      let baseUrl = baseUrlInputs[type];
      if (type === 'azure' && baseUrl) {
        baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        // Append /openai for Cognitive Services endpoints (required by Azure SDK)
        if (baseUrl.includes('cognitive.microsoft.com') && !baseUrl.endsWith('/openai')) {
          baseUrl = `${baseUrl}/openai`;
        }
      }

      await configureProvider.mutateAsync({
        type,
        apiKey: apiKeyInputs[type],
        baseUrl,
        defaultModel,
        // Include API version for Azure
        apiVersion: type === 'azure' ? azureApiVersion : undefined,
      });
    } finally {
      setSavingProvider(null);
    }
  };

  const handleTest = async (type: string) => {
    setTestingProvider(type);
    try {
      await testProvider.mutateAsync(type);
    } finally {
      setTestingProvider(null);
    }
  };

  const renderCard = (config: AIProviderConfig) => {
    const status = providers.find((p) => p.type === config.type);
    const isHealthy = status?.healthy;
    const isExpanded = expandedProvider === config.type;

    return (
      <div
        key={config.type}
        className={cn(
          'rounded-xl border transition-all',
          isHealthy
            ? 'border-green-500/30 bg-green-500/5'
            : 'border-border bg-muted/30'
        )}
      >
        <div
          className="flex items-center justify-between p-4 cursor-pointer"
          onClick={() => setExpandedProvider(isExpanded ? null : config.type)}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'h-10 w-10 rounded-xl flex items-center justify-center',
                isHealthy ? 'bg-green-500/10' : 'bg-muted/50'
              )}
            >
              <config.Logo
                className={cn('h-5 w-5', isHealthy && 'text-green-600')}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-medium">{config.name}</h4>
                {isHealthy && (
                  <span className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{config.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={config.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              Get Key
              <ExternalLink className="h-3 w-3" />
            </a>
            <ChevronRight
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                isExpanded && 'rotate-90'
              )}
            />
          </div>
        </div>
        {isExpanded && (
          <div className="px-4 pb-4 space-y-4 border-t border-border/50 pt-4">
            {/* API Key - shown for all except local-only providers */}
            {config.type !== 'ollama' && config.type !== 'copilot' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showApiKey[config.type] ? 'text' : 'password'}
                    placeholder={config.placeholder}
                    value={apiKeyInputs[config.type] || ''}
                    onChange={(e) =>
                      setApiKeyInputs((prev) => ({
                        ...prev,
                        [config.type]: e.target.value,
                      }))
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="w-full field pr-10"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowApiKey((prev) => ({
                        ...prev,
                        [config.type]: !prev[config.type],
                      }));
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey[config.type] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Azure-specific configuration */}
            {config.type === 'azure' && (
              <div className="space-y-4 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
                <div className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                  <Info className="h-3.5 w-3.5" />
                  Azure OpenAI Configuration
                </div>

                {/* Endpoint URL */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Endpoint URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://your-resource.openai.azure.com"
                    value={baseUrlInputs['azure'] || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBaseUrlInputs((prev) => ({ ...prev, azure: val }));
                      const validation = validateAzureEndpoint(val);
                      setAzureValidation((prev) => ({
                        ...prev,
                        endpoint: validation.message,
                      }));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      'w-full field font-mono text-xs',
                      azureValidation.endpoint && 'ring-1 ring-destructive'
                    )}
                  />
                  {azureValidation.endpoint && (
                    <p className="text-[10px] text-destructive mt-1">
                      {azureValidation.endpoint}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Supported formats: <code className="bg-muted px-1 rounded">https://your-resource.openai.azure.com</code> or <code className="bg-muted px-1 rounded">https://region.api.cognitive.microsoft.com</code>
                  </p>
                </div>

                {/* Model (Deployment Name) */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Model (Deployment Name)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., gpt-4o, gpt-4-turbo"
                    value={azureDeploymentName}
                    onChange={(e) => setAzureDeploymentName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full field"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    The deployment name from Model deployments section
                  </p>
                </div>

                {/* API Version */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    API Version
                  </label>
                  <select
                    value={azureApiVersion}
                    onChange={(e) => {
                      e.stopPropagation();
                      setAzureApiVersion(e.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full field appearance-none cursor-pointer"
                  >
                    {AZURE_API_VERSIONS.map((version) => (
                      <option key={version.value} value={version.value}>
                        {version.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Use <strong>2024-10-21</strong> for most models. Use <strong>2024-12-01-preview</strong> for o1/o1-mini reasoning models.
                  </p>
                </div>

                {/* Quick Help */}
                <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 text-[10px] text-muted-foreground">
                  <HelpCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium mb-1">Where to find these values:</p>
                    <ol className="list-decimal list-inside space-y-0.5">
                      <li>
                        Go to{' '}
                        <a
                          href="https://portal.azure.com/#blade/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          Azure Portal → Azure OpenAI
                        </a>
                      </li>
                      <li>Select your <strong>Azure OpenAI</strong> resource (not Cognitive Services)</li>
                      <li>Go to <strong>Keys and Endpoint</strong> under Resource Management</li>
                      <li>Copy the endpoint (format: <code>https://your-resource.openai.azure.com</code>)</li>
                      <li>Deployment Name is in <strong>Model deployments</strong> section</li>
                    </ol>
                    <p className="mt-2 text-amber-600 dark:text-amber-400">
                      ⚠️ Don't use regional endpoints like <code>eastus.api.cognitive.microsoft.com</code>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Base URL - shown for non-Azure providers that require it */}
            {config.requiresBaseUrl && config.type !== 'azure' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Base URL
                </label>
                <input
                  type="text"
                  placeholder={config.placeholder}
                  value={baseUrlInputs[config.type] || ''}
                  onChange={(e) =>
                    setBaseUrlInputs((prev) => ({
                      ...prev,
                      [config.type]: e.target.value,
                    }))
                  }
                  onClick={(e) => e.stopPropagation()}
                  className="w-full field"
                />
              </div>
            )}

            {/* Model Selection - text input for Azure, dropdown for others */}
            {config.type !== 'azure' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Default Model
                </label>
                {config.models.length > 0 ? (
                  <>
                    <select
                      value={modelInputs[config.type] || config.models[0]}
                      onChange={(e) => {
                        e.stopPropagation();
                        setModelInputs((prev) => ({
                          ...prev,
                          [config.type]: e.target.value,
                        }));
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full field appearance-none cursor-pointer"
                    >
                      {config.models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {config.models.length} model
                      {config.models.length !== 1 ? 's' : ''} available
                    </p>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Enter model name"
                      value={modelInputs[config.type] || ''}
                      onChange={(e) => {
                        setModelInputs((prev) => ({
                          ...prev,
                          [config.type]: e.target.value,
                        }));
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full field"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Enter your model identifier
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTest(config.type);
                }}
                disabled={testingProvider === config.type || (!status && !apiKeyInputs[config.type])}
                className="rounded-lg"
              >
                {testingProvider === config.type ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSave(config.type);
                }}
                disabled={savingProvider === config.type}
                className="rounded-lg"
              >
                {savingProvider === config.type ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </div>

            {/* Status Message */}
            {status?.message && (
              <p
                className={cn(
                  'text-xs',
                  isHealthy ? 'text-green-500' : 'text-muted-foreground'
                )}
              >
                {status.message}
                {status.latencyMs && ` (${status.latencyMs}ms)`}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="glass rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                'h-12 w-12 rounded-xl flex items-center justify-center',
                healthyCount > 0 ? 'bg-green-500/10' : 'bg-amber-500/10'
              )}
            >
              <Sparkles
                className={cn(
                  'h-6 w-6',
                  healthyCount > 0 ? 'text-green-500' : 'text-amber-500'
                )}
              />
            </div>
            <div>
              <h3 className="text-lg font-bold">AI Provider Status</h3>
              <p className="text-sm text-muted-foreground">
                {healthyCount > 0 ? (
                  <span className="text-green-500">
                    {healthyCount} provider{healthyCount !== 1 ? 's' : ''} connected
                  </span>
                ) : (
                  <span className="text-amber-500">No providers configured</span>
                )}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchProviders()}
            disabled={isRefetching}
            className="rounded-xl"
          >
            <RefreshCw
              className={cn('h-4 w-4 mr-2', isRefetching && 'animate-spin')}
            />
            Refresh
          </Button>
        </div>
        <div className="mt-4 flex items-start gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
          <Shield className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-blue-400 mb-1">Secure Storage</p>
            <p>
              API keys are encrypted and stored securely. Keys are transmitted
              over HTTPS and never logged.
            </p>
          </div>
        </div>
      </div>
      <SettingsCard
        title="Cloud Providers"
        description="Connect to hosted AI services"
      >
        <div className="space-y-3">
          {AI_PROVIDERS.filter((p) => p.category === 'cloud').map(renderCard)}
        </div>
      </SettingsCard>
      <SettingsCard title="Enterprise" description="Enterprise-grade AI">
        <div className="space-y-3">
          {AI_PROVIDERS.filter((p) => p.category === 'enterprise').map(renderCard)}
        </div>
      </SettingsCard>
      <SettingsCard title="Local & Self-Hosted" description="Run models locally">
        <div className="space-y-3">
          {AI_PROVIDERS.filter((p) => p.category === 'local').map(renderCard)}
        </div>
        <div className="mt-4 flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border">
          <Terminal className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium mb-1">Quick Ollama Setup</p>
            <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded">
              curl -fsSL https://ollama.com/install.sh | sh && ollama serve
            </code>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-3 p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
          <Github className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium mb-1 text-indigo-600 dark:text-indigo-400">
              GitHub Copilot Proxy Setup (Experimental)
            </p>
            <p className="mb-2">
              Use your existing Copilot subscription for free inference:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[11px]">
              <li>
                Install:{' '}
                <code className="bg-muted px-1 py-0.5 rounded">npx copilot-api</code>
              </li>
              <li>Authenticate with GitHub when prompted</li>
              <li>
                Enter{' '}
                <code className="bg-muted px-1 py-0.5 rounded">
                  http://localhost:4141
                </code>{' '}
                above
              </li>
            </ol>
            <a
              href="https://github.com/ericc-ch/copilot-api"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-indigo-500 hover:underline"
            >
              View full setup guide
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </SettingsCard>
    </>
  );
}
