/**
 * Settings Feature Constants and Types
 */

import {
  Settings2,
  User,
  Bell,
  Sparkles,
  Key,
  Shield,
  Plug,
  Database,
  Cpu,
  Tag,
  Smartphone,
  Brain,
  Puzzle,
  Wrench,
  MessageCircle,
} from 'lucide-react';
import {
  AnthropicLogo,
  OpenAILogo,
  GoogleLogo,
  AzureLogo,
  GroqLogo,
  OpenRouterLogo,
  OllamaLogo,
  XAILogo,
  MistralLogo,
  CohereLogo,
  PerplexityLogo,
  DeepSeekLogo,
  TogetherLogo,
  CerebrasLogo,
  FireworksLogo,
  CopilotLogo,
} from '@/components/shared/ProviderLogos';

// Settings sections for navigation
export const SETTINGS_SECTIONS = [
  {
    id: 'general',
    label: 'General',
    icon: Settings2,
    description: 'Appearance and preferences',
  },
  {
    id: 'account',
    label: 'Account',
    icon: User,
    description: 'Profile and recovery codes',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    description: 'Alert preferences',
  },
  {
    id: 'ai-providers',
    label: 'AI Providers',
    icon: Sparkles,
    description: 'Configure AI models',
  },
  {
    id: 'labels',
    label: 'Labels',
    icon: Tag,
    description: 'Manage project labels',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Key,
    description: 'API keys and services',
  },
  {
    id: 'messaging',
    label: 'Messaging',
    icon: MessageCircle,
    description: 'Telegram, Discord, WhatsApp',
  },
  {
    id: 'devices',
    label: 'Devices',
    icon: Smartphone,
    description: 'Manage paired devices',
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: Brain,
    description: 'Semantic memory system',
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: Puzzle,
    description: 'Modular AI capabilities',
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: Wrench,
    description: 'AI tool configuration',
  },
  {
    id: 'security',
    label: 'Security',
    icon: Shield,
    description: 'Tool execution security',
  },
  {
    id: 'plugins',
    label: 'Plugins & MCP',
    icon: Plug,
    description: 'Extensions and MCP',
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: Database,
    description: 'Data and backup',
  },
  {
    id: 'system',
    label: 'System',
    icon: Cpu,
    description: 'Advanced settings',
  },
] as const;

export type SectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

// AI Provider configuration
export interface AIProviderConfig {
  type: string;
  name: string;
  description: string;
  Logo: React.ComponentType<{ className?: string }>;
  setupUrl: string;
  placeholder: string;
  category: 'cloud' | 'enterprise' | 'local';
  models: string[];
  requiresBaseUrl?: boolean;
  status?: 'stable' | 'beta' | 'experimental';
}

export const AI_PROVIDERS: AIProviderConfig[] = [
  // Cloud providers
  {
    type: 'anthropic',
    name: 'Anthropic',
    description: 'Claude Opus, Sonnet, Haiku',
    Logo: AnthropicLogo,
    setupUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'openai',
    name: 'OpenAI',
    description: 'GPT-4.5, o1, o3-mini',
    Logo: OpenAILogo,
    setupUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'google',
    name: 'Google AI',
    description: 'Gemini 2.5 Pro, Flash',
    Logo: GoogleLogo,
    setupUrl: 'https://makersuite.google.com/app/apikey',
    placeholder: 'AIza...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'xai',
    name: 'xAI (Grok)',
    description: 'Grok 2, Grok 3 models',
    Logo: XAILogo,
    setupUrl: 'https://console.x.ai/',
    placeholder: 'xai-...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'mistral',
    name: 'Mistral AI',
    description: 'Mistral Large, Medium, Codestral',
    Logo: MistralLogo,
    setupUrl: 'https://console.mistral.ai/api-keys/',
    placeholder: 'your-key...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'cohere',
    name: 'Cohere',
    description: 'Command R, R+',
    Logo: CohereLogo,
    setupUrl: 'https://dashboard.cohere.com/api-keys',
    placeholder: 'your-key...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'perplexity',
    name: 'Perplexity',
    description: 'Sonar models with search',
    Logo: PerplexityLogo,
    setupUrl: 'https://www.perplexity.ai/settings/api',
    placeholder: 'pplx-...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek Chat, Coder, R1',
    Logo: DeepSeekLogo,
    setupUrl: 'https://platform.deepseek.com/api_keys',
    placeholder: 'sk-...',
    category: 'cloud',
    models: [],
  },
  // Fast inference
  {
    type: 'groq',
    name: 'Groq',
    description: 'Ultra-fast Llama & Mixtral',
    Logo: GroqLogo,
    setupUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'together',
    name: 'Together AI',
    description: 'Fast open-source models',
    Logo: TogetherLogo,
    setupUrl: 'https://api.together.xyz/settings/api-keys',
    placeholder: 'your-key...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'cerebras',
    name: 'Cerebras',
    description: 'Fastest Llama inference',
    Logo: CerebrasLogo,
    setupUrl: 'https://cloud.cerebras.ai/',
    placeholder: 'csk-...',
    category: 'cloud',
    models: [],
  },
  {
    type: 'fireworks',
    name: 'Fireworks',
    description: 'Fast serverless inference',
    Logo: FireworksLogo,
    setupUrl: 'https://fireworks.ai/account/api-keys',
    placeholder: 'fw-...',
    category: 'cloud',
    models: [],
  },
  // Router/Aggregator
  {
    type: 'openrouter',
    name: 'OpenRouter',
    description: '300+ models via one API',
    Logo: OpenRouterLogo,
    setupUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-...',
    category: 'cloud',
    models: [],
  },
  // Enterprise
  {
    type: 'azure',
    name: 'Azure OpenAI',
    description: 'Enterprise GPT-4 via Azure / Foundry',
    Logo: AzureLogo,
    setupUrl: 'https://portal.azure.com/',
    placeholder: 'your-key...',
    category: 'enterprise',
    models: [], // Models come from user's Azure deployment
    requiresBaseUrl: true, // For Azure Foundry custom endpoints
  },
  // Local
  {
    type: 'ollama',
    name: 'Ollama (Local)',
    description: 'Run models locally - free',
    Logo: OllamaLogo,
    setupUrl: 'https://ollama.ai/download',
    placeholder: 'http://localhost:11434',
    category: 'local',
    models: [],
    requiresBaseUrl: true,
  },
  {
    type: 'copilot',
    name: 'GitHub Copilot',
    description: 'Use your Copilot subscription (experimental)',
    Logo: CopilotLogo,
    setupUrl: 'https://github.com/ericc-ch/copilot-api',
    placeholder: 'http://localhost:4141',
    category: 'local',
    models: [],
    requiresBaseUrl: true,
    status: 'experimental',
  },
];

// Azure API versions - ordered by recommendation
// Reference: https://learn.microsoft.com/en-us/azure/ai-services/openai/api-version-lifecycle
export const AZURE_API_VERSIONS = [
  { value: '2024-10-21', label: '2024-10-21 (Recommended - Stable)' },
  { value: '2024-12-01-preview', label: '2024-12-01-preview (For o1/o1-mini)' },
  { value: '2025-01-01-preview', label: '2025-01-01-preview (Latest Preview)' },
  { value: '2024-08-01-preview', label: '2024-08-01-preview' },
  { value: '2024-02-15-preview', label: '2024-02-15-preview (Legacy)' },
];

// Azure regions
export const AZURE_REGIONS = [
  { value: 'eastus', label: 'East US' },
  { value: 'eastus2', label: 'East US 2' },
  { value: 'westus', label: 'West US' },
  { value: 'westus2', label: 'West US 2' },
  { value: 'westus3', label: 'West US 3' },
  { value: 'centralus', label: 'Central US' },
  { value: 'northcentralus', label: 'North Central US' },
  { value: 'southcentralus', label: 'South Central US' },
  { value: 'westeurope', label: 'West Europe' },
  { value: 'northeurope', label: 'North Europe' },
  { value: 'uksouth', label: 'UK South' },
  { value: 'ukwest', label: 'UK West' },
  { value: 'francecentral', label: 'France Central' },
  { value: 'germanywestcentral', label: 'Germany West Central' },
  { value: 'swedencentral', label: 'Sweden Central' },
  { value: 'switzerlandnorth', label: 'Switzerland North' },
  { value: 'australiaeast', label: 'Australia East' },
  { value: 'japaneast', label: 'Japan East' },
  { value: 'koreacentral', label: 'Korea Central' },
  { value: 'southeastasia', label: 'Southeast Asia' },
  { value: 'eastasia', label: 'East Asia' },
  { value: 'canadaeast', label: 'Canada East' },
  { value: 'brazilsouth', label: 'Brazil South' },
];

// Validation helpers
export function validateAzureEndpoint(
  url: string
): { valid: boolean; message?: string; warning?: string } {
  if (!url) return { valid: true }; // Empty is OK (will use resource name)
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith('https')) {
      return { valid: false, message: 'Must use HTTPS' };
    }

    // Both formats are valid for Azure OpenAI:
    // 1. https://{resource}.openai.azure.com (newer format)
    // 2. https://{region}.api.cognitive.microsoft.com (regional endpoint)
    const isAzureOpenAI = url.includes('openai.azure.com');
    const isCognitiveServices = url.includes('cognitive.microsoft.com') || url.includes('cognitiveservices.azure.com');

    if (isAzureOpenAI || isCognitiveServices) {
      return { valid: true };
    }

    // Unknown endpoint format
    return {
      valid: false,
      message: 'Must be an Azure endpoint (e.g., https://your-resource.openai.azure.com or https://eastus.api.cognitive.microsoft.com)',
    };
  } catch {
    return { valid: false, message: 'Invalid URL format' };
  }
}

export function validateAzureResourceName(
  name: string
): { valid: boolean; message?: string } {
  if (!name) return { valid: true };
  if (!/^[a-zA-Z0-9-]+$/.test(name)) {
    return { valid: false, message: 'Only letters, numbers, and hyphens allowed' };
  }
  if (name.length < 2 || name.length > 64) {
    return { valid: false, message: 'Must be 2-64 characters' };
  }
  return { valid: true };
}

// API base URL
export const API_BASE = 'http://localhost:3000';
