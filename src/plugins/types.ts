/**
 * profClaw Plugin System Types
 *
 * Extensible plugin architecture for chat tools, search providers,
 * and other integrations.
 */

// Core Plugin Types

export type PluginCategory = 'search' | 'tool' | 'integration' | 'model';

export interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  icon?: string; // Lucide icon name
  version: string;
  author?: string;
  homepage?: string;
  pricing?: {
    type: 'free' | 'paid' | 'freemium' | 'credit-based';
    costPer1k?: number; // Cost per 1000 requests
    freeQuota?: number; // Free requests per month
  };
  rateLimit?: {
    requestsPerSecond?: number;
    requestsPerMinute?: number;
    requestsPerDay?: number;
  };
}

export interface PluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  priority: number; // Higher = preferred
  settings: Record<string, unknown>;
  credentials?: PluginCredentials;
}

export interface PluginCredentials {
  apiKey?: string;
  baseUrl?: string;
  [key: string]: string | undefined;
}

export interface PluginHealth {
  healthy: boolean;
  lastCheck: Date;
  latency?: number; // ms
  errorMessage?: string;
  usageStats?: {
    requestsToday: number;
    requestsThisMonth: number;
    tokensUsed?: number;
    costEstimate?: number;
  };
}

// Search Provider Types

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source?: string;
  favicon?: string;
  citations?: Array<{ text: string; url: string }>;
  score?: number; // Relevance score 0-1
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  language?: string;
  region?: string;
  freshness?: 'day' | 'week' | 'month' | 'year';
  safeSearch?: boolean | 'moderate' | 'strict';
  includeImages?: boolean;
  includeNews?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalResults?: number;
  searchTime?: number; // ms
  provider: string;
  cached?: boolean;
}

export interface SearchProvider {
  metadata: PluginMetadata;
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<PluginHealth>;
}

export type SearchProviderFactory = (config: PluginConfig) => SearchProvider;

// Tool Types (for AI function calling)

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  returns?: {
    type: string;
    description: string;
  };
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: {
    executionTime: number;
    tokensUsed?: number;
    cost?: number;
  };
}

export interface ToolProvider {
  metadata: PluginMetadata;
  tools: ToolDefinition[];
  execute(toolName: string, params: Record<string, unknown>): Promise<ToolResult>;
  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<PluginHealth>;
}

export type ToolProviderFactory = (config: PluginConfig) => ToolProvider;

// Registry Types

export interface PluginRegistry<T> {
  register(id: string, factory: (config: PluginConfig) => T): void;
  unregister(id: string): void;
  create(config: PluginConfig): T;
  get(id: string): T | undefined;
  getAll(): T[];
  getAvailable(): T[];
  listRegistered(): string[];
  getHealth(id: string): Promise<PluginHealth>;
}

// Settings Schema Types (for UI generation)

export interface SettingsField {
  key: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'url';
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
}

export interface PluginSettingsSchema {
  credentials: SettingsField[];
  settings: SettingsField[];
}

// Plugin Definition (for registration)

export interface SearchPluginDefinition {
  metadata: PluginMetadata;
  settingsSchema: PluginSettingsSchema;
  factory: SearchProviderFactory;
}

export interface ToolPluginDefinition {
  metadata: PluginMetadata;
  settingsSchema: PluginSettingsSchema;
  factory: ToolProviderFactory;
}

export type PluginDefinition = SearchPluginDefinition | ToolPluginDefinition;
