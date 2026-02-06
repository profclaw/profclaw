/**
 * Environment Variable Validator
 * 
 * Validates required and optional environment variables at startup.
 * Fails fast with clear error messages if required variables are missing.
 */

import { createContextualLogger } from './logger.js';

const log = createContextualLogger('EnvValidator');

export interface EnvVarSpec {
  name: string;
  required: boolean;
  default?: string;
  description: string;
  secret?: boolean; // If true, don't log the value
  validate?: (value: string) => boolean | string; // Return true or error message
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  loaded: Record<string, string>;
}

/**
 * All environment variables used by the application
 */
export const ENV_SPEC: EnvVarSpec[] = [
  // Server
  { name: 'PORT', required: false, default: '3000', description: 'HTTP server port' },
  { name: 'NODE_ENV', required: false, default: 'development', description: 'Node environment (development/production/test)' },
  
  // Storage
  { name: 'STORAGE_TIER', required: false, default: 'local', description: 'Storage backend: memory, local (file), libsql' },
  { name: 'LIBSQL_URL', required: false, description: 'LibSQL database URL (required if STORAGE_TIER=libsql)' },
  { name: 'LIBSQL_AUTH_TOKEN', required: false, secret: true, description: 'LibSQL auth token for Turso cloud' },
  { name: 'DATA_PATH', required: false, default: './data', description: 'Path for file-based storage' },
  
  // Redis/Queue
  { name: 'REDIS_URL', required: false, description: 'Redis URL for task queue (optional, enables background jobs)' },
  
  // Cron
  { name: 'ENABLE_CRON', required: false, default: 'true', description: 'Enable scheduled job execution' },
  
  // CORS
  { name: 'CORS_ORIGIN', required: false, description: 'Allowed CORS origin (comma-separated for multiple)' },
  
  // AI Providers
  { name: 'ANTHROPIC_API_KEY', required: false, secret: true, description: 'Anthropic API key for Claude models' },
  { name: 'OPENAI_API_KEY', required: false, secret: true, description: 'OpenAI API key for GPT models' },
  { name: 'GOOGLE_AI_API_KEY', required: false, secret: true, description: 'Google AI API key for Gemini models' },
  { name: 'AZURE_OPENAI_API_KEY', required: false, secret: true, description: 'Azure OpenAI API key' },
  { name: 'AZURE_OPENAI_ENDPOINT', required: false, description: 'Azure OpenAI endpoint URL' },
  { name: 'OLLAMA_URL', required: false, default: 'http://localhost:11434', description: 'Ollama server URL for local models' },
  
  // Integrations - GitHub
  { name: 'GITHUB_CLIENT_ID', required: false, description: 'GitHub OAuth app client ID' },
  { name: 'GITHUB_CLIENT_SECRET', required: false, secret: true, description: 'GitHub OAuth app client secret' },
  { name: 'GITHUB_TOKEN', required: false, secret: true, description: 'GitHub personal access token' },
  { name: 'GITHUB_WEBHOOK_SECRET', required: false, secret: true, description: 'GitHub webhook signature secret' },
  
  // Integrations - JIRA
  { name: 'JIRA_CLIENT_ID', required: false, description: 'JIRA OAuth client ID' },
  { name: 'JIRA_CLIENT_SECRET', required: false, secret: true, description: 'JIRA OAuth client secret' },
  { name: 'JIRA_CLOUD_ID', required: false, description: 'JIRA Cloud instance ID' },
  
  // Integrations - Linear
  { name: 'LINEAR_API_KEY', required: false, secret: true, description: 'Linear API key' },
  { name: 'LINEAR_WEBHOOK_SECRET', required: false, secret: true, description: 'Linear webhook signature secret' },
  
  // Integrations - Slack
  { name: 'SLACK_BOT_TOKEN', required: false, secret: true, description: 'Slack bot OAuth token' },
  { name: 'SLACK_SIGNING_SECRET', required: false, secret: true, description: 'Slack request signing secret' },
  { name: 'SLACK_APP_TOKEN', required: false, secret: true, description: 'Slack app-level token (for Socket Mode)' },
  
  // Integrations - Discord
  { name: 'DISCORD_BOT_TOKEN', required: false, secret: true, description: 'Discord bot token' },
  { name: 'DISCORD_APPLICATION_ID', required: false, description: 'Discord application ID' },
  { name: 'DISCORD_PUBLIC_KEY', required: false, description: 'Discord public key for verification' },
  { name: 'DISCORD_CLIENT_SECRET', required: false, secret: true, description: 'Discord client secret for OAuth' },
  
  // Integrations - Telegram
  { name: 'TELEGRAM_BOT_TOKEN', required: false, secret: true, description: 'Telegram bot token from BotFather' },
  
  // Integrations - WhatsApp
  { name: 'WHATSAPP_ACCESS_TOKEN', required: false, secret: true, description: 'WhatsApp Business API access token' },
  { name: 'WHATSAPP_PHONE_NUMBER_ID', required: false, description: 'WhatsApp Business phone number ID' },
  { name: 'WHATSAPP_VERIFY_TOKEN', required: false, secret: true, description: 'WhatsApp webhook verify token' },
  
  // Search
  { name: 'SEARXNG_URL', required: false, default: 'https://searx.tiekoetter.com', description: 'SearXNG instance for web search' },
  
  // Embeddings
  { name: 'EMBEDDING_PROVIDER', required: false, default: 'local', description: 'Embedding provider: local, openai, voyage' },
  { name: 'VOYAGE_API_KEY', required: false, secret: true, description: 'Voyage AI API key for embeddings' },
];

/**
 * Validate all environment variables
 */
export function validateEnvironment(options: {
  exitOnError?: boolean;
  logResults?: boolean;
} = {}): ValidationResult {
  const { exitOnError = false, logResults = true } = options;
  
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    loaded: {},
  };

  for (const spec of ENV_SPEC) {
    const value = process.env[spec.name];
    
    if (!value && spec.required) {
      result.valid = false;
      result.errors.push(`Missing required environment variable: ${spec.name} - ${spec.description}`);
    } else if (!value && spec.default) {
      // Apply default
      process.env[spec.name] = spec.default;
      result.loaded[spec.name] = spec.default;
      if (logResults) {
        log.debug(`Using default for ${spec.name}: ${spec.secret ? '[HIDDEN]' : spec.default}`);
      }
    } else if (value) {
      result.loaded[spec.name] = value;
      
      // Run custom validation if provided
      if (spec.validate) {
        const validateResult = spec.validate(value);
        if (validateResult !== true) {
          result.valid = false;
          result.errors.push(`Invalid value for ${spec.name}: ${validateResult}`);
        }
      }
    }
  }

  // Cross-validation checks
  if (process.env.STORAGE_TIER === 'libsql' && !process.env.LIBSQL_URL) {
    result.valid = false;
    result.errors.push('STORAGE_TIER=libsql requires LIBSQL_URL to be set');
  }

  // Warnings for missing optional but recommended vars
  const hasAnyAIKey = process.env.ANTHROPIC_API_KEY || 
                       process.env.OPENAI_API_KEY || 
                       process.env.GOOGLE_AI_API_KEY;
  if (!hasAnyAIKey) {
    result.warnings.push('No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_AI_API_KEY for AI features.');
  }

  // Log results
  if (logResults) {
    if (result.errors.length > 0) {
      log.error('Environment validation failed:');
      result.errors.forEach(err => log.error(`  ❌ ${err}`));
    }
    
    if (result.warnings.length > 0) {
      result.warnings.forEach(warn => log.warn(`  ⚠️  ${warn}`));
    }

    if (result.valid && result.errors.length === 0) {
      log.info('Environment validation passed ✓');
    }
  }

  // Exit if configured to do so
  if (!result.valid && exitOnError) {
    log.error('Server startup aborted due to environment errors. Fix the issues above and restart.');
    process.exit(1);
  }

  return result;
}

/**
 * Get a summary of configured integrations
 */
export function getConfiguredIntegrations(): string[] {
  const integrations: string[] = [];
  
  if (process.env.GITHUB_TOKEN || process.env.GITHUB_CLIENT_ID) integrations.push('GitHub');
  if (process.env.JIRA_CLIENT_ID) integrations.push('JIRA');
  if (process.env.LINEAR_API_KEY) integrations.push('Linear');
  if (process.env.SLACK_BOT_TOKEN) integrations.push('Slack');
  if (process.env.DISCORD_BOT_TOKEN) integrations.push('Discord');
  if (process.env.TELEGRAM_BOT_TOKEN) integrations.push('Telegram');
  if (process.env.WHATSAPP_ACCESS_TOKEN) integrations.push('WhatsApp');
  
  return integrations;
}

/**
 * Get a summary of configured AI providers
 */
export function getConfiguredAIProviders(): string[] {
  const providers: string[] = [];
  
  if (process.env.ANTHROPIC_API_KEY) providers.push('Anthropic (Claude)');
  if (process.env.OPENAI_API_KEY) providers.push('OpenAI (GPT)');
  if (process.env.GOOGLE_AI_API_KEY) providers.push('Google (Gemini)');
  if (process.env.AZURE_OPENAI_API_KEY) providers.push('Azure OpenAI');
  if (process.env.OLLAMA_URL) providers.push('Ollama (local)');
  
  return providers;
}

/**
 * Generate .env.example content
 */
export function generateEnvExample(): string {
  const lines: string[] = [
    '# profClaw Environment Configuration',
    '# Generated from ENV_SPEC in src/utils/env-validator.ts',
    '# Copy this file to .env and fill in your values',
    '',
  ];

  let currentCategory = '';
  
  for (const spec of ENV_SPEC) {
    // Add category headers based on name patterns
    const category = spec.name.split('_')[0];
    if (category !== currentCategory) {
      currentCategory = category;
      lines.push('');
      lines.push(`# ─── ${getCategory(spec.name)} ───`);
    }
    
    // Add description and example
    lines.push(`# ${spec.description}`);
    if (spec.default) {
      lines.push(`${spec.name}=${spec.default}`);
    } else if (spec.secret) {
      lines.push(`# ${spec.name}=your_secret_here`);
    } else {
      lines.push(`# ${spec.name}=`);
    }
  }

  return lines.join('\n');
}

function getCategory(name: string): string {
  const prefix = name.split('_')[0];
  const categories: Record<string, string> = {
    PORT: 'Server',
    NODE: 'Server',
    STORAGE: 'Storage',
    LIBSQL: 'Storage',
    DATA: 'Storage',
    REDIS: 'Queue',
    ENABLE: 'Features',
    CORS: 'Security',
    ANTHROPIC: 'AI Providers',
    OPENAI: 'AI Providers',
    GOOGLE: 'AI Providers',
    AZURE: 'AI Providers',
    OLLAMA: 'AI Providers',
    GITHUB: 'GitHub Integration',
    JIRA: 'JIRA Integration',
    LINEAR: 'Linear Integration',
    SLACK: 'Slack Integration',
    DISCORD: 'Discord Integration',
    TELEGRAM: 'Telegram Integration',
    WHATSAPP: 'WhatsApp Integration',
    SEARXNG: 'Search',
    EMBEDDING: 'Embeddings',
    VOYAGE: 'Embeddings',
  };
  return categories[prefix] || 'Other';
}
