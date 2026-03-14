/**
 * Smart API Key Detection
 *
 * Detects API keys in chat messages and extracts provider information.
 * Inspired by OpenClaw's configure wizard - users can naturally say
 * "here's my OpenAI key: sk-..." and we auto-configure.
 */

import { logger } from '../utils/logger.js';

// Types

export interface DetectedApiKey {
  provider: 'openai' | 'anthropic' | 'azure' | 'google' | 'groq' | 'openrouter' | 'ollama';
  apiKey: string;
  confidence: 'high' | 'medium' | 'low';
  matchedPattern: string;
  baseUrl?: string; // For Ollama or custom endpoints
}

export interface ApiKeyDetectionResult {
  detected: boolean;
  keys: DetectedApiKey[];
  sanitizedMessage: string; // Message with keys redacted for logging
}

// API Key Patterns

interface ApiKeyPattern {
  provider: DetectedApiKey['provider'];
  // Pattern to match the key itself
  keyPattern: RegExp;
  // Patterns to detect provider context (e.g., "OpenAI key", "my anthropic")
  contextPatterns: RegExp[];
  // Key prefix for validation
  keyPrefix?: string;
  minLength: number;
  maxLength: number;
}

const API_KEY_PATTERNS: ApiKeyPattern[] = [
  {
    provider: 'openai',
    keyPattern: /sk-[a-zA-Z0-9_-]{20,}/g,
    contextPatterns: [
      /openai\s*(api)?\s*key/i,
      /gpt\s*(api)?\s*key/i,
      /chatgpt\s*key/i,
      /OPENAI_API_KEY/i,
    ],
    keyPrefix: 'sk-',
    minLength: 40,
    maxLength: 200,
  },
  {
    provider: 'anthropic',
    keyPattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g,
    contextPatterns: [
      /anthropic\s*(api)?\s*key/i,
      /claude\s*(api)?\s*key/i,
      /ANTHROPIC_API_KEY/i,
    ],
    keyPrefix: 'sk-ant-',
    minLength: 50,
    maxLength: 200,
  },
  {
    provider: 'groq',
    keyPattern: /gsk_[a-zA-Z0-9]{20,}/g,
    contextPatterns: [
      /groq\s*(api)?\s*key/i,
      /GROQ_API_KEY/i,
    ],
    keyPrefix: 'gsk_',
    minLength: 40,
    maxLength: 100,
  },
  {
    provider: 'openrouter',
    keyPattern: /sk-or-[a-zA-Z0-9_-]{20,}/g,
    contextPatterns: [
      /openrouter\s*(api)?\s*key/i,
      /OPENROUTER_API_KEY/i,
    ],
    keyPrefix: 'sk-or-',
    minLength: 40,
    maxLength: 100,
  },
  {
    provider: 'google',
    // Google API keys are typically 39 chars, alphanumeric with underscores
    keyPattern: /AIza[a-zA-Z0-9_-]{35}/g,
    contextPatterns: [
      /google\s*(ai)?\s*(api)?\s*key/i,
      /gemini\s*(api)?\s*key/i,
      /GOOGLE_API_KEY/i,
      /GOOGLE_GENERATIVE_AI_API_KEY/i,
    ],
    keyPrefix: 'AIza',
    minLength: 39,
    maxLength: 45,
  },
  {
    provider: 'azure',
    // Azure keys are typically 32 hex chars
    keyPattern: /[a-fA-F0-9]{32}/g,
    contextPatterns: [
      /azure\s*(openai)?\s*(api)?\s*key/i,
      /AZURE_OPENAI_API_KEY/i,
      /AZURE_API_KEY/i,
    ],
    minLength: 32,
    maxLength: 40,
  },
];

// URL/Endpoint Patterns

const ENDPOINT_PATTERNS = [
  {
    provider: 'ollama' as const,
    patterns: [
      /(?:ollama\s*(?:url|endpoint|base\s*url|server)?:?\s*)(https?:\/\/[^\s]+)/i,
      /(?:OLLAMA_BASE_URL|OLLAMA_HOST)\s*[=:]\s*['"]?(https?:\/\/[^\s'"]+)/i,
      /(https?:\/\/localhost:\d+)(?:\/|$)/i,
      /(https?:\/\/127\.0\.0\.1:\d+)(?:\/|$)/i,
    ],
    defaultPort: 11434,
  },
  {
    provider: 'azure' as const,
    patterns: [
      /(?:azure\s*(?:openai)?\s*(?:url|endpoint|base\s*url)?:?\s*)(https:\/\/[^\s]+\.openai\.azure\.com)/i,
      /AZURE_OPENAI_ENDPOINT\s*[=:]\s*['"]?(https:\/\/[^\s'"]+)/i,
    ],
  },
];

// Detection Functions

/**
 * Detect API keys in a message
 */
export function detectApiKeys(message: string): ApiKeyDetectionResult {
  const keys: DetectedApiKey[] = [];
  let sanitizedMessage = message;

  // First, try to detect provider from context
  const detectedProviders = detectProviderContext(message);

  // Then, look for API key patterns
  for (const pattern of API_KEY_PATTERNS) {
    const matches = message.matchAll(pattern.keyPattern);

    for (const match of matches) {
      const apiKey = match[0];

      // Validate key length
      if (apiKey.length < pattern.minLength || apiKey.length > pattern.maxLength) {
        continue;
      }

      // Determine confidence based on context
      let confidence: DetectedApiKey['confidence'] = 'low';

      // High confidence if we have explicit context
      if (detectedProviders.includes(pattern.provider)) {
        confidence = 'high';
      }
      // Medium confidence if key has distinctive prefix
      else if (pattern.keyPrefix && apiKey.startsWith(pattern.keyPrefix)) {
        confidence = 'medium';
      }

      // Check for Azure endpoint in message
      let baseUrl: string | undefined;
      if (pattern.provider === 'azure') {
        const endpoint = detectEndpoint(message, 'azure');
        if (endpoint) {
          baseUrl = endpoint;
          confidence = 'high'; // Higher confidence with endpoint
        }
      }

      keys.push({
        provider: pattern.provider,
        apiKey,
        confidence,
        matchedPattern: pattern.keyPattern.source,
        baseUrl,
      });

      // Redact key in sanitized message
      sanitizedMessage = sanitizedMessage.replace(apiKey, `[${pattern.provider.toUpperCase()}_KEY_REDACTED]`);
    }
  }

  // Check for Ollama endpoint (doesn't need API key)
  const ollamaEndpoint = detectEndpoint(message, 'ollama');
  if (ollamaEndpoint) {
    keys.push({
      provider: 'ollama',
      apiKey: '', // Ollama doesn't need an API key
      confidence: 'high',
      matchedPattern: 'ollama_endpoint',
      baseUrl: ollamaEndpoint,
    });
    sanitizedMessage = sanitizedMessage.replace(ollamaEndpoint, '[OLLAMA_ENDPOINT_REDACTED]');
  }

  // De-duplicate by provider (keep highest confidence)
  const uniqueKeys = deduplicateKeys(keys);

  return {
    detected: uniqueKeys.length > 0,
    keys: uniqueKeys,
    sanitizedMessage,
  };
}

/**
 * Detect provider context from message
 */
function detectProviderContext(message: string): Array<DetectedApiKey['provider']> {
  const providers: Array<DetectedApiKey['provider']> = [];

  for (const pattern of API_KEY_PATTERNS) {
    for (const contextPattern of pattern.contextPatterns) {
      if (contextPattern.test(message)) {
        providers.push(pattern.provider);
        break;
      }
    }
  }

  return providers;
}

/**
 * Detect endpoint URL for a provider
 */
function detectEndpoint(message: string, provider: 'ollama' | 'azure'): string | undefined {
  const endpointPattern = ENDPOINT_PATTERNS.find(p => p.provider === provider);
  if (!endpointPattern) return undefined;

  for (const pattern of endpointPattern.patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  // For Ollama, also check for localhost mentions without full URL
  if (provider === 'ollama') {
    const localhostMatch = message.match(/localhost:(\d+)/i);
    if (localhostMatch) {
      return `http://localhost:${localhostMatch[1]}`;
    }

    // Check for just "ollama" mentioned with no key - user might want local
    if (/\bollama\b/i.test(message) && !/key|api/i.test(message)) {
      return 'http://localhost:11434';
    }
  }

  return undefined;
}

/**
 * De-duplicate keys, keeping highest confidence per provider
 */
function deduplicateKeys(keys: DetectedApiKey[]): DetectedApiKey[] {
  const byProvider = new Map<string, DetectedApiKey>();

  const confidenceRank = { high: 3, medium: 2, low: 1 };

  for (const key of keys) {
    const existing = byProvider.get(key.provider);
    if (!existing || confidenceRank[key.confidence] > confidenceRank[existing.confidence]) {
      byProvider.set(key.provider, key);
    }
  }

  return Array.from(byProvider.values());
}

/**
 * Check if a message likely contains an API key
 * (quick check without full detection)
 */
export function mightContainApiKey(message: string): boolean {
  // Quick patterns to check
  const quickPatterns = [
    /sk-[a-zA-Z0-9]/,          // OpenAI, OpenRouter, Anthropic prefixes
    /gsk_[a-zA-Z0-9]/,          // Groq prefix
    /AIza[a-zA-Z0-9]/,          // Google prefix
    /api.?key/i,                // "api key" mentions
    /API_KEY/,                  // Environment variable style
    /\b(openai|anthropic|claude|gemini|groq|azure)\b.*\b(key|token|secret)\b/i,
  ];

  return quickPatterns.some(p => p.test(message));
}

/**
 * Generate a system prompt addition for API key handling
 */
export function getApiKeyHandlingPrompt(): string {
  return `
When users provide API keys in their messages, you should:
1. Immediately use the configureProvider tool to save the key
2. Confirm which provider was configured
3. Never repeat the full API key back to the user
4. Suggest they test the connection

Supported providers:
- OpenAI (keys start with sk-)
- Anthropic/Claude (keys start with sk-ant-)
- Google/Gemini (keys start with AIza)
- Groq (keys start with gsk_)
- OpenRouter (keys start with sk-or-)
- Azure OpenAI (32 character hex keys, needs endpoint)
- Ollama (local, no key needed, just endpoint URL)

If the user mentions wanting to use a local model or Ollama, configure Ollama with the appropriate endpoint (default: http://localhost:11434).
`.trim();
}

/**
 * Create tool invocation suggestion for detected keys
 */
export function createConfigureToolCall(key: DetectedApiKey): {
  name: string;
  arguments: Record<string, unknown>;
} {
  return {
    name: 'configureProvider',
    arguments: {
      provider: key.provider,
      apiKey: key.apiKey,
      baseUrl: key.baseUrl,
      setAsDefault: true, // Default to setting as default when user provides key
    },
  };
}

// Log detection for debugging (without exposing keys)
export function logDetection(result: ApiKeyDetectionResult): void {
  if (result.detected) {
    logger.info(`[ApiKeyDetector] Detected ${result.keys.length} API key(s)`, {
      component: 'ApiKeyDetector',
      providers: result.keys.map(k => k.provider),
      confidences: result.keys.map(k => k.confidence),
    });
  }
}
