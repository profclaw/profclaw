/**
 * Smart Model Router
 *
 * Classifies query complexity and routes to the cheapest model
 * that can handle it. This is the engine behind profClaw's "10x cheaper" claim.
 *
 * Complexity tiers:
 *   trivial  -> Haiku/Groq/Gemini Flash ($0.001-0.005/conv)
 *   standard -> Sonnet/GPT-4o/Gemini Pro ($0.02-0.05/conv)
 *   complex  -> Opus/GPT-4.5/Gemini Ultra ($0.05-0.15/conv)
 *
 * The router saves users 60-90% vs always using a top-tier model.
 */

import { logger } from '../utils/logger.js';
import { MODEL_CATALOG } from './core/models.js';
import type { ModelInfo, ProviderType } from './core/types.js';

// Types

export type ComplexityTier = 'trivial' | 'standard' | 'complex';

export interface ComplexitySignal {
  name: string;
  weight: number;
  matched: boolean;
  detail?: string;
}

export interface ComplexityResult {
  tier: ComplexityTier;
  score: number;
  confidence: number;
  signals: ComplexitySignal[];
  reasoning: string;
}

export interface ProviderRecommendation {
  provider: ProviderType;
  model: string;
  reason: string;
  estimatedSavings: string;
  signupUrl: string;
  freeTrialAvailable: boolean;
}

export interface RoutingDecision {
  complexity: ComplexityResult;
  selectedModel: ModelInfo;
  alternativeModels: ModelInfo[];
  estimatedCost: number;
  savedVsDefault: number;
  savingsPercent: number;
  missingProviderHint?: ProviderRecommendation;
}

export interface SmartRouterConfig {
  enabled: boolean;
  defaultModel: string;
  preferredProviders: ProviderType[];
  maxCostPerRequest: number;
  enableLocalFallback: boolean;
  complexityThresholds: {
    trivialMax: number;
    standardMax: number;
  };
}

// Default config - overridable via env or runtime config
// defaultModel is empty - resolved dynamically from available providers
const DEFAULT_CONFIG: SmartRouterConfig = {
  enabled: true,
  defaultModel: '', // resolved dynamically via resolveDefaultModel()
  preferredProviders: [],
  maxCostPerRequest: 0.50,
  enableLocalFallback: true,
  complexityThresholds: {
    trivialMax: 0.25,
    standardMax: 0.60,
  },
};

/**
 * Resolve the default model from whatever providers are available.
 * Picks the best mid-range model from configured providers.
 * Truly provider-agnostic - works with any combination.
 */
export function resolveDefaultModel(availableProviders: Set<ProviderType>): string {
  // If user explicitly set a default, use it
  if (config.defaultModel) return config.defaultModel;

  // Find the best "standard tier" model from available providers, sorted by quality-per-dollar
  const candidates = MODEL_CATALOG
    .filter(m => availableProviders.has(m.provider))
    .filter(m => m.supportsTools && m.supportsStreaming)
    .filter(m => m.contextWindow >= 32000) // need decent context
    .sort((a, b) => {
      // Quality heuristic: context window * tool support, balanced against cost
      const aScore = a.contextWindow / 1000 / Math.max(a.costPer1MInput + a.costPer1MOutput, 0.01);
      const bScore = b.contextWindow / 1000 / Math.max(b.costPer1MInput + b.costPer1MOutput, 0.01);
      return bScore - aScore; // higher score = better value
    });

  return candidates[0]?.id ?? MODEL_CATALOG[0]?.id ?? 'llama3.2';
}

let config: SmartRouterConfig = { ...DEFAULT_CONFIG };

// Complexity Signal Definitions

interface SignalMatcher {
  name: string;
  weight: number;
  test: (prompt: string, context: RoutingContext) => string | false;
}

interface RoutingContext {
  conversationLength: number;
  hasToolUse: boolean;
  hasCodeContext: boolean;
  hasImages: boolean;
  previousModel?: string;
  sessionCostSoFar: number;
}

/**
 * Signals that push toward HIGHER complexity (need stronger model).
 * Each returns a detail string if matched, false otherwise.
 */
const COMPLEXITY_UP_SIGNALS: SignalMatcher[] = [
  {
    name: 'multi_step_reasoning',
    weight: 0.20,
    test: (prompt) => {
      const patterns = [
        /\b(analyze|compare|evaluate|assess|critique|design|architect|plan)\b/i,
        /\b(step by step|think through|break down|walk me through)\b/i,
        /\b(trade.?offs?|pros? and cons|advantages? and disadvantages?)\b/i,
        /\b(why.*and.*how|how.*and.*why)\b/i,
      ];
      const matched = patterns.filter(p => p.test(prompt));
      return matched.length >= 1
        ? `reasoning keywords (${matched.length} patterns)`
        : false;
    },
  },
  {
    name: 'code_generation',
    weight: 0.15,
    test: (prompt) => {
      const patterns = [
        /\b(implement|refactor|write|create|build|develop)\b.*\b(function|class|component|module|service|api|endpoint|handler)\b/i,
        /\b(fix|debug|resolve)\b.*\b(bug|error|issue|crash|failure)\b/i,
        /```[\s\S]{50,}/,
      ];
      const matched = patterns.filter(p => p.test(prompt));
      return matched.length >= 1 ? 'code generation/debugging request' : false;
    },
  },
  {
    name: 'long_context',
    weight: 0.12,
    test: (prompt, ctx) => {
      if (prompt.length > 2000) return `long prompt (${prompt.length} chars)`;
      if (ctx.conversationLength > 10) return `long conversation (${ctx.conversationLength} turns)`;
      return false;
    },
  },
  {
    name: 'tool_orchestration',
    weight: 0.15,
    test: (_prompt, ctx) => {
      return ctx.hasToolUse ? 'tool use enabled' : false;
    },
  },
  {
    name: 'image_analysis',
    weight: 0.10,
    test: (_prompt, ctx) => {
      return ctx.hasImages ? 'image analysis required' : false;
    },
  },
  {
    name: 'creative_complex',
    weight: 0.10,
    test: (prompt) => {
      const patterns = [
        /\b(write|draft|compose)\b.*\b(essay|article|report|documentation|spec|rfc)\b/i,
        /\b(translate|convert|migrate|port)\b.*\b(from|to|into)\b/i,
      ];
      return patterns.some(p => p.test(prompt)) ? 'complex creative task' : false;
    },
  },
  {
    name: 'multi_file_scope',
    weight: 0.10,
    test: (prompt) => {
      const fileRefs = prompt.match(/\b[\w-]+\.(ts|js|py|go|rs|java|tsx|jsx|vue|svelte|css|html)\b/g);
      return fileRefs && fileRefs.length > 2
        ? `multi-file scope (${fileRefs.length} files referenced)`
        : false;
    },
  },
  {
    name: 'system_design',
    weight: 0.18,
    test: (prompt) => {
      const patterns = [
        /\b(system design|architecture|infrastructure|scaling|distributed)\b/i,
        /\b(database schema|api design|microservice|event.?driven)\b/i,
        /\b(security|auth|encryption|compliance|gdpr|hipaa)\b/i,
      ];
      const matched = patterns.filter(p => p.test(prompt));
      return matched.length >= 1 ? 'system design/architecture' : false;
    },
  },
];

/**
 * Signals that push toward LOWER complexity (cheap model is fine).
 */
const COMPLEXITY_DOWN_SIGNALS: SignalMatcher[] = [
  {
    name: 'simple_question',
    weight: -0.20,
    test: (prompt) => {
      if (prompt.length < 100 && /^(what|who|when|where|how much|how many|is |are |does |do |can |will )/i.test(prompt)) {
        return 'short factual question';
      }
      return false;
    },
  },
  {
    name: 'greeting_chitchat',
    weight: -0.25,
    test: (prompt) => {
      const patterns = [
        /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|got it|cool|nice|great|good morning|good night)\b/i,
        /^(how are you|what's up|what can you do)\b/i,
      ];
      return patterns.some(p => p.test(prompt.trim())) ? 'greeting/chitchat' : false;
    },
  },
  {
    name: 'format_conversion',
    weight: -0.15,
    test: (prompt) => {
      const patterns = [
        /\b(convert|format|prettify|minify|sort|list|enumerate)\b/i,
        /\b(json|yaml|csv|xml|markdown|html)\b.*\b(to|from|into)\b/i,
      ];
      return patterns.some(p => p.test(prompt)) && prompt.length < 300
        ? 'simple format/conversion'
        : false;
    },
  },
  {
    name: 'lookup_retrieval',
    weight: -0.18,
    test: (prompt) => {
      const patterns = [
        /\b(show|get|find|list|display|fetch|check)\b.*\b(status|config|settings|version|info)\b/i,
        /\b(what is|define|explain briefly|summarize in one)\b/i,
      ];
      return patterns.some(p => p.test(prompt)) && prompt.length < 200
        ? 'simple lookup/retrieval'
        : false;
    },
  },
  {
    name: 'typo_fix',
    weight: -0.22,
    test: (prompt) => {
      const patterns = [
        /\b(fix typo|rename|change name|update string|change text|replace)\b/i,
        /\b(add comment|add import|remove import|add export)\b/i,
      ];
      return patterns.some(p => p.test(prompt)) && prompt.length < 200
        ? 'trivial edit'
        : false;
    },
  },
  {
    name: 'short_prompt',
    weight: -0.10,
    test: (prompt) => {
      return prompt.length < 50 ? `very short prompt (${prompt.length} chars)` : false;
    },
  },
];

// Core Functions

/**
 * Classify the complexity of a user prompt.
 */
export function classifyComplexity(
  prompt: string,
  context: Partial<RoutingContext> = {},
): ComplexityResult {
  const ctx: RoutingContext = {
    conversationLength: context.conversationLength ?? 0,
    hasToolUse: context.hasToolUse ?? false,
    hasCodeContext: context.hasCodeContext ?? false,
    hasImages: context.hasImages ?? false,
    previousModel: context.previousModel,
    sessionCostSoFar: context.sessionCostSoFar ?? 0,
  };

  const signals: ComplexitySignal[] = [];
  let score = 0.35; // baseline: lean slightly toward standard

  // Evaluate UP signals
  for (const signal of COMPLEXITY_UP_SIGNALS) {
    const result = signal.test(prompt, ctx);
    const matched = result !== false;
    signals.push({
      name: signal.name,
      weight: signal.weight,
      matched,
      detail: matched ? (result as string) : undefined,
    });
    if (matched) score += signal.weight;
  }

  // Evaluate DOWN signals
  for (const signal of COMPLEXITY_DOWN_SIGNALS) {
    const result = signal.test(prompt, ctx);
    const matched = result !== false;
    signals.push({
      name: signal.name,
      weight: signal.weight,
      matched,
      detail: matched ? (result as string) : undefined,
    });
    if (matched) score += signal.weight; // weight is already negative
  }

  // Clamp to [0, 1]
  score = Math.max(0, Math.min(1, score));

  // Classify tier
  const { trivialMax, standardMax } = config.complexityThresholds;
  let tier: ComplexityTier;
  if (score <= trivialMax) {
    tier = 'trivial';
  } else if (score <= standardMax) {
    tier = 'standard';
  } else {
    tier = 'complex';
  }

  // Confidence: how many signals fired and how strongly
  const matchedSignals = signals.filter(s => s.matched);
  const confidence = Math.min(1, 0.4 + matchedSignals.length * 0.12);

  const reasoning = matchedSignals.length > 0
    ? matchedSignals.map(s => s.detail).join('; ')
    : 'no strong signals, defaulting to standard';

  return { tier, score, confidence, signals, reasoning };
}

/**
 * Cost thresholds per tier (cost per 1M input tokens).
 * Models below the threshold qualify for that tier.
 * This replaces the old hardcoded MODEL_PREFERENCES.
 */
const TIER_COST_CEILINGS: Record<ComplexityTier, number> = {
  trivial: 1.00,    // $1/1M input - cheap models only
  standard: 5.00,   // $5/1M input - mid-range
  complex: Infinity, // no ceiling - best available
};

/**
 * Minimum capability requirements per tier.
 */
const TIER_REQUIREMENTS: Record<ComplexityTier, {
  minContext: number;
  requiresTools: boolean;
  requiresVision: boolean;
  preferStreaming: boolean;
}> = {
  trivial: { minContext: 4096, requiresTools: false, requiresVision: false, preferStreaming: true },
  standard: { minContext: 32000, requiresTools: true, requiresVision: false, preferStreaming: true },
  complex: { minContext: 64000, requiresTools: true, requiresVision: false, preferStreaming: true },
};

/**
 * Dynamically select the best model from the catalog for a given tier.
 * Truly provider-agnostic - works with ANY combination of configured providers.
 *
 * Selection strategy per tier:
 *   trivial  -> cheapest model that meets minimum requirements
 *   standard -> best value (capability/cost ratio)
 *   complex  -> most capable model (largest context, best tools support)
 */
function getCandidatesForTier(
  tier: ComplexityTier,
  availableProviders: Set<ProviderType>,
  signals: ComplexitySignal[],
): ModelInfo[] {
  const ceiling = TIER_COST_CEILINGS[tier];
  const reqs = TIER_REQUIREMENTS[tier];
  const needsVision = signals.some(s => s.name === 'image_analysis' && s.matched);
  const needsTools = signals.some(s => s.name === 'tool_orchestration' && s.matched);

  // Filter catalog to available + capable models
  const eligible = MODEL_CATALOG.filter(m => {
    if (!availableProviders.has(m.provider)) return false;
    if (m.costPer1MInput > ceiling) return false;
    if (m.contextWindow < reqs.minContext) return false;
    if ((reqs.requiresTools || needsTools) && !m.supportsTools) return false;
    if (needsVision && !m.supportsVision) return false;
    if (reqs.preferStreaming && !m.supportsStreaming) return false;
    return true;
  });

  // Sort by tier strategy
  switch (tier) {
    case 'trivial':
      // Cheapest first (total cost = input + output rate)
      return eligible.sort((a, b) =>
        (a.costPer1MInput + a.costPer1MOutput) - (b.costPer1MInput + b.costPer1MOutput),
      );

    case 'standard':
      // Best value: capability (context * tool support) per dollar
      return eligible.sort((a, b) => {
        const costA = Math.max(a.costPer1MInput + a.costPer1MOutput, 0.01);
        const costB = Math.max(b.costPer1MInput + b.costPer1MOutput, 0.01);
        const valueA = (a.contextWindow / 1000) * (a.supportsTools ? 2 : 1) / costA;
        const valueB = (b.contextWindow / 1000) * (b.supportsTools ? 2 : 1) / costB;
        return valueB - valueA;
      });

    case 'complex':
      // Most capable first: largest context, tool support, then cost as tiebreaker
      return eligible.sort((a, b) => {
        // Primary: context window (larger = more capable)
        if (a.contextWindow !== b.contextWindow) return b.contextWindow - a.contextWindow;
        // Secondary: vision support
        if (a.supportsVision !== b.supportsVision) return a.supportsVision ? -1 : 1;
        // Tertiary: cost (cheaper preferred among equals)
        return (a.costPer1MInput + a.costPer1MOutput) - (b.costPer1MInput + b.costPer1MOutput);
      });
  }
}

/**
 * Select the best model for a given complexity tier.
 * Fully dynamic - queries the MODEL_CATALOG based on available providers.
 * No hardcoded model IDs or provider assumptions.
 */
export function selectModel(
  complexity: ComplexityResult,
  availableProviders: Set<ProviderType>,
  overrideModel?: string,
): RoutingDecision {
  const effectiveDefault = config.defaultModel || resolveDefaultModel(availableProviders);

  // If user explicitly chose a model, respect it
  if (overrideModel) {
    const modelInfo = findModelInCatalog(overrideModel);
    if (modelInfo) {
      const defaultCost = estimateConversationCost(effectiveDefault);
      const actualCost = estimateConversationCost(overrideModel);
      return {
        complexity,
        selectedModel: modelInfo,
        alternativeModels: [],
        estimatedCost: actualCost,
        savedVsDefault: defaultCost - actualCost,
        savingsPercent: defaultCost > 0 ? Math.round(((defaultCost - actualCost) / defaultCost) * 100) : 0,
      };
    }
  }

  // Dynamic model selection from catalog
  let candidates = getCandidatesForTier(complexity.tier, availableProviders, complexity.signals);

  // If no candidates at this tier, try relaxing to the next tier up
  if (candidates.length === 0 && complexity.tier === 'trivial') {
    candidates = getCandidatesForTier('standard', availableProviders, complexity.signals);
  }
  if (candidates.length === 0 && complexity.tier !== 'complex') {
    candidates = getCandidatesForTier('complex', availableProviders, complexity.signals);
  }

  // Apply user provider preferences
  if (config.preferredProviders.length > 0 && candidates.length > 1) {
    candidates = [...candidates].sort((a, b) => {
      const aPreferred = config.preferredProviders.includes(a.provider) ? 0 : 1;
      const bPreferred = config.preferredProviders.includes(b.provider) ? 0 : 1;
      return aPreferred - bPreferred; // preferred first, preserve existing order within
    });
  }

  // Pick best match, fall back to any available model
  const selected = candidates[0]
    ?? findModelInCatalog(effectiveDefault)
    ?? MODEL_CATALOG.find(m => availableProviders.has(m.provider))
    ?? MODEL_CATALOG[0];

  const alternatives = candidates.slice(1, 4);
  const estimatedCost = estimateConversationCost(selected.id);
  const defaultCost = estimateConversationCost(effectiveDefault);

  // Check if a cheaper provider the user hasn't configured could help
  const missingProviderHint = findMissingProviderHint(
    complexity.tier,
    availableProviders,
    estimatedCost,
  );

  const decision: RoutingDecision = {
    complexity,
    selectedModel: selected,
    alternativeModels: alternatives,
    estimatedCost,
    savedVsDefault: defaultCost - estimatedCost,
    savingsPercent: defaultCost > 0
      ? Math.round(((defaultCost - estimatedCost) / defaultCost) * 100)
      : 0,
    missingProviderHint,
  };

  logger.info('[SmartRouter] Routed query', {
    tier: complexity.tier,
    score: Math.round(complexity.score * 100),
    confidence: Math.round(complexity.confidence * 100),
    model: selected.id,
    provider: selected.provider,
    estimatedCost: `$${estimatedCost.toFixed(4)}`,
    savings: `${decision.savingsPercent}%`,
    reasoning: complexity.reasoning,
  });

  return decision;
}

/**
 * One-shot: classify + select in a single call.
 */
export function routeQuery(
  prompt: string,
  availableProviders: Set<ProviderType>,
  context: Partial<RoutingContext> = {},
  overrideModel?: string,
): RoutingDecision {
  const complexity = classifyComplexity(prompt, context);
  return selectModel(complexity, availableProviders, overrideModel);
}

// Provider Recommendations

/**
 * Cheap providers that users should add for maximum savings.
 * Ordered by value: free/cheapest first.
 */
const RECOMMENDED_PROVIDERS: Array<{
  provider: ProviderType;
  model: string;
  tier: ComplexityTier;
  costPer1MInput: number;
  reason: string;
  signupUrl: string;
  freeTrialAvailable: boolean;
  envVar: string;
}> = [
  {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    tier: 'trivial',
    costPer1MInput: 0,
    reason: 'Free tier handles trivial queries - greetings, lookups, simple Q&A',
    signupUrl: 'https://console.groq.com',
    freeTrialAvailable: true,
    envVar: 'GROQ_API_KEY',
  },
  {
    provider: 'google',
    model: 'gemini-2.0-flash',
    tier: 'trivial',
    costPer1MInput: 0.50,
    reason: 'Ultra-cheap for simple tasks, generous free tier',
    signupUrl: 'https://aistudio.google.com/apikey',
    freeTrialAvailable: true,
    envVar: 'GOOGLE_API_KEY',
  },
  {
    provider: 'cerebras',
    model: 'llama3.1-8b',
    tier: 'trivial',
    costPer1MInput: 0.10,
    reason: 'Fastest inference for trivial queries at $0.10/1M tokens',
    signupUrl: 'https://cloud.cerebras.ai',
    freeTrialAvailable: true,
    envVar: 'CEREBRAS_API_KEY',
  },
  {
    provider: 'deepseek',
    model: 'deepseek-chat',
    tier: 'standard',
    costPer1MInput: 0.27,
    reason: 'Near-Sonnet quality at 1/10th the price for coding tasks',
    signupUrl: 'https://platform.deepseek.com',
    freeTrialAvailable: true,
    envVar: 'DEEPSEEK_API_KEY',
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    tier: 'trivial',
    costPer1MInput: 0.80,
    reason: 'Best quality for the price in the Anthropic family',
    signupUrl: 'https://console.anthropic.com',
    freeTrialAvailable: false,
    envVar: 'ANTHROPIC_API_KEY',
  },
];

/**
 * Check if a cheaper provider exists that the user hasn't configured.
 */
function findMissingProviderHint(
  tier: ComplexityTier,
  availableProviders: Set<ProviderType>,
  currentCost: number,
): ProviderRecommendation | undefined {
  for (const rec of RECOMMENDED_PROVIDERS) {
    // Skip if user already has this provider
    if (availableProviders.has(rec.provider)) continue;
    // Only recommend providers relevant to the query's tier
    if (rec.tier !== tier && tier !== 'trivial') continue;
    // Only recommend if it would be meaningfully cheaper
    const recCost = estimateConversationCost(rec.model);
    if (recCost >= currentCost * 0.7) continue; // need at least 30% savings to recommend

    const savingsPercent = currentCost > 0
      ? Math.round(((currentCost - recCost) / currentCost) * 100)
      : 0;

    return {
      provider: rec.provider,
      model: rec.model,
      reason: rec.reason,
      estimatedSavings: `${savingsPercent}% cheaper ($${recCost.toFixed(4)} vs $${currentCost.toFixed(4)}/conv)`,
      signupUrl: rec.signupUrl,
      freeTrialAvailable: rec.freeTrialAvailable,
    };
  }
  return undefined;
}

/**
 * Analyze usage patterns and generate cost optimization recommendations.
 * Call this from the dashboard or CLI doctor command.
 */
export function getCostOptimizationAdvice(
  availableProviders: Set<ProviderType>,
): Array<{
  priority: 'high' | 'medium' | 'low';
  action: string;
  reason: string;
  estimatedMonthlySavings: string;
  envVar: string;
  signupUrl: string;
}> {
  const advice: Array<{
    priority: 'high' | 'medium' | 'low';
    action: string;
    reason: string;
    estimatedMonthlySavings: string;
    envVar: string;
    signupUrl: string;
  }> = [];

  const stats = getRoutingStats();

  // If most queries are trivial but no free/cheap provider is configured
  if (!availableProviders.has('groq') && !availableProviders.has('cerebras')) {
    const trivialPercent = stats.totalRouted > 0
      ? Math.round((stats.byTier.trivial / stats.totalRouted) * 100)
      : 40; // estimate 40% trivial if no data yet

    if (trivialPercent > 20) {
      advice.push({
        priority: 'high',
        action: `Add Groq (free tier) - set GROQ_API_KEY`,
        reason: `${trivialPercent}% of your queries are trivial and could run for free on Groq's Llama 70B`,
        estimatedMonthlySavings: stats.totalRouted > 0
          ? `$${(stats.byTier.trivial * 0.015).toFixed(2)}/month`
          : '$5-15/month (estimated)',
        envVar: 'GROQ_API_KEY',
        signupUrl: 'https://console.groq.com',
      });
    }
  }

  // If no Google provider (Gemini Flash is excellent value)
  if (!availableProviders.has('google')) {
    advice.push({
      priority: 'medium',
      action: 'Add Google Gemini - set GOOGLE_API_KEY',
      reason: 'Gemini Flash at $0.50/1M is 6x cheaper than Haiku for trivial tasks, with generous free tier',
      estimatedMonthlySavings: '$3-10/month',
      envVar: 'GOOGLE_API_KEY',
      signupUrl: 'https://aistudio.google.com/apikey',
    });
  }

  // If no DeepSeek (best value for coding)
  if (!availableProviders.has('deepseek') && availableProviders.size <= 2) {
    advice.push({
      priority: 'medium',
      action: 'Add DeepSeek - set DEEPSEEK_API_KEY',
      reason: 'DeepSeek Chat at $0.27/1M handles coding tasks nearly as well as Sonnet at 1/10th the price',
      estimatedMonthlySavings: '$5-20/month',
      envVar: 'DEEPSEEK_API_KEY',
      signupUrl: 'https://platform.deepseek.com',
    });
  }

  // If only one provider configured
  if (availableProviders.size === 1) {
    const single = [...availableProviders][0];
    advice.push({
      priority: 'high',
      action: 'Add at least one more provider for failover and cost optimization',
      reason: `You only have ${single} configured. If it goes down or rate-limits you, profClaw can't fall back. Adding a second provider also unlocks smart routing savings.`,
      estimatedMonthlySavings: '$10-30/month (plus reliability)',
      envVar: single === 'anthropic' ? 'GROQ_API_KEY' : 'ANTHROPIC_API_KEY',
      signupUrl: single === 'anthropic' ? 'https://console.groq.com' : 'https://console.anthropic.com',
    });
  }

  // If Ollama is available, suggest using it for trivial queries
  if (availableProviders.has('ollama') && !availableProviders.has('groq')) {
    advice.push({
      priority: 'low',
      action: 'Smart routing will use Ollama for trivial queries (free)',
      reason: 'Your local Ollama models handle greetings and simple lookups at zero API cost',
      estimatedMonthlySavings: '$2-5/month',
      envVar: '',
      signupUrl: '',
    });
  }

  // Optimal setup check
  const optimalProviders: ProviderType[] = ['groq', 'anthropic', 'google'];
  const hasOptimal = optimalProviders.every(p => availableProviders.has(p));
  if (hasOptimal && advice.length === 0) {
    advice.push({
      priority: 'low',
      action: 'Your provider setup is cost-optimal',
      reason: 'Groq (free trivial) + Gemini (cheap standard) + Anthropic (quality complex) covers all tiers efficiently',
      estimatedMonthlySavings: 'Already optimized',
      envVar: '',
      signupUrl: '',
    });
  }

  return advice;
}

// Helpers

function findModelInCatalog(modelId: string): ModelInfo | undefined {
  return MODEL_CATALOG.find(m => m.id === modelId);
}

/**
 * Estimate cost for a typical 6-turn conversation.
 * Assumes ~1,800 total tokens (900 in, 900 out) per conversation.
 */
function estimateConversationCost(modelId: string): number {
  const info = findModelInCatalog(modelId);
  if (!info) return 0.03; // fallback estimate
  const inputCost = (900 / 1_000_000) * info.costPer1MInput;
  const outputCost = (900 / 1_000_000) * info.costPer1MOutput;
  return inputCost + outputCost;
}

/**
 * Get a human-readable cost comparison for display.
 */
export function getCostComparison(decision: RoutingDecision): string {
  const { complexity, selectedModel, estimatedCost, savingsPercent } = decision;

  if (savingsPercent <= 0) {
    return `${selectedModel.name} ($${estimatedCost.toFixed(4)}/conv)`;
  }

  return [
    `Routed to ${selectedModel.name} (${complexity.tier})`,
    `Est. cost: $${estimatedCost.toFixed(4)}/conv`,
    `Saving ${savingsPercent}% vs default model`,
  ].join(' | ');
}

/**
 * Get cumulative savings stats for display in dashboard.
 */
export function getRoutingStats(): {
  totalRouted: number;
  totalSaved: number;
  byTier: Record<ComplexityTier, number>;
  avgSavingsPercent: number;
} {
  return { ...routingStats };
}

// Stats tracking (in-memory, persisted via cost history)
const routingStats = {
  totalRouted: 0,
  totalSaved: 0,
  byTier: { trivial: 0, standard: 0, complex: 0 } as Record<ComplexityTier, number>,
  avgSavingsPercent: 0,
};

/**
 * Record a routing decision for stats.
 */
export function recordRoutingDecision(decision: RoutingDecision): void {
  routingStats.totalRouted++;
  routingStats.byTier[decision.complexity.tier]++;
  routingStats.totalSaved += decision.savedVsDefault;

  // Rolling average
  routingStats.avgSavingsPercent =
    routingStats.avgSavingsPercent +
    (decision.savingsPercent - routingStats.avgSavingsPercent) / routingStats.totalRouted;
}

// Configuration

export function configureSmartRouter(newConfig: Partial<SmartRouterConfig>): void {
  config = { ...config, ...newConfig };

  // Allow env override
  if (process.env['SMART_ROUTER_ENABLED'] === 'false') {
    config.enabled = false;
  }
  if (process.env['SMART_ROUTER_MAX_COST']) {
    config.maxCostPerRequest = parseFloat(process.env['SMART_ROUTER_MAX_COST']);
  }

  logger.info('[SmartRouter] Configuration updated', {
    enabled: config.enabled,
    defaultModel: config.defaultModel,
    maxCost: config.maxCostPerRequest,
  });
}

export function getSmartRouterConfig(): SmartRouterConfig {
  return { ...config };
}

export function isSmartRouterEnabled(): boolean {
  return config.enabled;
}
