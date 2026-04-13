/**
 * Chat API Routes
 *
 * REST API for AI chat functionality with profClaw intelligence.
 * Supports multiple providers, conversation history, and context-aware prompts.
 */

import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  NativeToolCall,
  NativeToolResult,
  ProviderConfig,
  ProviderType,
} from "../providers/index.js";
import {
  routeQuery,
  recordRoutingDecision,
  isSmartRouterEnabled,
  getCostComparison,
  type RoutingDecision,
} from "../providers/smart-router.js";
import { logger } from "../utils/logger.js";
import { rateLimit } from "../middleware/rate-limit.js";
import type {
  ChatContext,
  ConversationMessage,
} from "../chat/index.js";

const chatRoutes = new Hono();

// Per-IP sliding-window rate limiter for chat send endpoints
const chatMaxRequests = parseInt(process.env['CHAT_RATE_LIMIT'] ?? '20', 10);
const chatRateLimiter = rateLimit({
  maxRequests: chatMaxRequests,
  windowMs: 60_000,
  message: `Chat rate limit exceeded. Maximum ${chatMaxRequests} messages per minute.`,
});

let chatRuntimePromise: Promise<void> | null = null;

let ProviderTypeSchema: typeof import("../providers/index.js")["ProviderType"];
let aiProvider: typeof import("../providers/index.js")["aiProvider"];
let MODEL_ALIASES: typeof import("../providers/index.js")["MODEL_ALIASES"];
let saveProviderConfig: typeof import("../storage/index.js")["saveProviderConfig"];
let getClient: typeof import("../storage/index.js")["getClient"];
let CHAT_PRESETS: typeof import("../chat/index.js")["CHAT_PRESETS"];
let QUICK_ACTIONS: typeof import("../chat/index.js")["QUICK_ACTIONS"];
let buildSystemPrompt: typeof import("../chat/index.js")["buildSystemPrompt"];
let createConversation: typeof import("../chat/index.js")["createConversation"];
let getConversation: typeof import("../chat/index.js")["getConversation"];
let listConversations: typeof import("../chat/index.js")["listConversations"];
let deleteConversation: typeof import("../chat/index.js")["deleteConversation"];
let addMessage: typeof import("../chat/index.js")["addMessage"];
let getConversationMessages: typeof import("../chat/index.js")["getConversationMessages"];
let deleteMessage: typeof import("../chat/index.js")["deleteMessage"];
let getRecentConversationsWithPreview: typeof import("../chat/index.js")["getRecentConversationsWithPreview"];
let compactMessages: typeof import("../chat/index.js")["compactMessages"];
let getMemoryStats: typeof import("../chat/index.js")["getMemoryStats"];
let needsCompaction: typeof import("../chat/index.js")["needsCompaction"];
let CHAT_SKILLS: typeof import("../chat/index.js")["CHAT_SKILLS"];
let MODEL_TIERS: typeof import("../chat/index.js")["MODEL_TIERS"];
let detectIntent: typeof import("../chat/index.js")["detectIntent"];
let selectModel: typeof import("../chat/index.js")["selectModel"];
let createChatToolHandler: typeof import("../chat/index.js")["createChatToolHandler"];
let getDefaultChatTools: typeof import("../chat/index.js")["getDefaultChatTools"];
let getAllChatTools: typeof import("../chat/index.js")["getAllChatTools"];
let getChatToolsForModel: typeof import("../chat/index.js")["getChatToolsForModel"];
let getSessionModel: typeof import("../chat/index.js")["getSessionModel"];
let streamAgenticChat: typeof import("../chat/index.js")["streamAgenticChat"];
let getGroupChatManager: typeof import("../chat/index.js")["getGroupChatManager"];
let trackChatUsage: typeof import("../costs/token-tracker.js")["trackChatUsage"];

async function ensureChatRuntime(): Promise<void> {
  if (!chatRuntimePromise) {
    chatRuntimePromise = Promise.all([
      import("../providers/index.js"),
      import("../storage/index.js"),
      import("../chat/index.js"),
      import("../costs/token-tracker.js"),
    ])
      .then(([providersModule, storageModule, chatModule, costsModule]) => {
        ProviderTypeSchema = providersModule.ProviderType;
        aiProvider = providersModule.aiProvider;
        MODEL_ALIASES = providersModule.MODEL_ALIASES;
        saveProviderConfig = storageModule.saveProviderConfig;
        getClient = storageModule.getClient;
        CHAT_PRESETS = chatModule.CHAT_PRESETS;
        QUICK_ACTIONS = chatModule.QUICK_ACTIONS;
        buildSystemPrompt = chatModule.buildSystemPrompt;
        createConversation = chatModule.createConversation;
        getConversation = chatModule.getConversation;
        listConversations = chatModule.listConversations;
        deleteConversation = chatModule.deleteConversation;
        addMessage = chatModule.addMessage;
        getConversationMessages = chatModule.getConversationMessages;
        deleteMessage = chatModule.deleteMessage;
        getRecentConversationsWithPreview =
          chatModule.getRecentConversationsWithPreview;
        compactMessages = chatModule.compactMessages;
        getMemoryStats = chatModule.getMemoryStats;
        needsCompaction = chatModule.needsCompaction;
        CHAT_SKILLS = chatModule.CHAT_SKILLS;
        MODEL_TIERS = chatModule.MODEL_TIERS;
        detectIntent = chatModule.detectIntent;
        selectModel = chatModule.selectModel;
        createChatToolHandler = chatModule.createChatToolHandler;
        getDefaultChatTools = chatModule.getDefaultChatTools;
        getAllChatTools = chatModule.getAllChatTools;
        getChatToolsForModel = chatModule.getChatToolsForModel;
        getSessionModel = chatModule.getSessionModel;
        streamAgenticChat = chatModule.streamAgenticChat;
        getGroupChatManager = chatModule.getGroupChatManager;
        trackChatUsage = costsModule.trackChatUsage;
      })
      .catch((error) => {
        chatRuntimePromise = null;
        throw error;
      });
  }

  await chatRuntimePromise;
}

function parseProviderType(value: string): ProviderType | null {
  const parsed = ProviderTypeSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

chatRoutes.use("*", async (c, next) => {
  try {
    await ensureChatRuntime();
  } catch (error) {
    logger.error(
      "[Chat] Failed to initialize runtime",
      error instanceof Error ? error : undefined,
    );
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Chat runtime unavailable",
      },
      500,
    );
  }

  await next();
});

// === Schemas ===

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const ChatCompletionSchema = z.object({
  messages: z.array(ChatMessageSchema),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  stream: z.boolean().optional(),
  // Context linking
  conversationId: z.string().optional(),
  ticketId: z.string().optional(),
  taskId: z.string().optional(),
});

const ProviderConfigSchema = z.object({
  type: z.enum([
    "anthropic",
    "openai",
    "azure",
    "google",
    "ollama",
    "openrouter",
    "groq",
    "xai",
    "mistral",
    "cohere",
    "perplexity",
    "deepseek",
    "together",
    "cerebras",
    "fireworks",
  ]),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  // Azure-specific fields
  resourceName: z.string().optional(),
  deploymentName: z.string().optional(),
  apiVersion: z.string().optional(),
  defaultModel: z.string().optional(),
  enabled: z.boolean().optional(),
});

// === Routes ===

/**
 * GET /api/chat/model-capability
 * Returns capability tier and tool access level for a given model ID
 */
chatRoutes.get("/model-capability", async (c) => {
  const model = c.req.query("model");
  if (!model) {
    return c.json({ capability: "reasoning", tier: "full", maxSchemaTokens: 20000 });
  }
  const { getModelRouting } = await import("../chat/execution/model-capability.js");
  // Resolve alias to full model ID (e.g. "gemini" -> "gemini-1.5-pro")
  const { MODEL_ALIASES } = await import("../providers/core/models.js");
  const resolved = MODEL_ALIASES[model.toLowerCase()]?.model ?? model;
  return c.json(getModelRouting(resolved));
});

/**
 * POST /api/chat/send
 * Simple one-shot chat - send a message and get a response
 */
chatRoutes.post(
  "/send",
  chatRateLimiter,
  zValidator(
    "json",
    z.object({
      message: z.string(),
      model: z.string().optional(),
      systemPrompt: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().positive().optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");

    try {
      const messages: ChatMessage[] = [
        {
          id: randomUUID(),
          role: "user",
          content: body.message,
          timestamp: new Date().toISOString(),
        },
      ];

      // Smart routing: auto-select model if none specified
      let routing: RoutingDecision | undefined;
      let modelToUse = body.model;

      if (!body.model && isSmartRouterEnabled()) {
        const providers = new Set(aiProvider.getConfiguredProviders() as ProviderType[]);
        routing = routeQuery(body.message, providers);
        modelToUse = routing.selectedModel.id;
        recordRoutingDecision(routing);
      }

      const response = await aiProvider.chat({
        messages,
        model: modelToUse,
        systemPrompt: body.systemPrompt,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      });

      // Track token usage for cost dashboard
      if (response.usage?.totalTokens && response.model) {
        await ensureChatRuntime();
        trackChatUsage(response.model, response.usage.totalTokens, response.usage.promptTokens, response.usage.completionTokens);
      }

      return c.json({
        id: response.id,
        provider: response.provider,
        model: response.model,
        reply: response.content,
        finishReason: response.finishReason,
        usage: response.usage,
        duration: response.duration,
        ...(routing && {
          routing: {
            smartRouted: true,
            complexity: routing.complexity.tier,
            confidence: Math.round(routing.complexity.confidence * 100),
            reasoning: routing.complexity.reasoning,
            savings: `${routing.savingsPercent}%`,
            estimatedCost: `$${routing.estimatedCost.toFixed(4)}`,
            summary: getCostComparison(routing),
            ...(routing.missingProviderHint && {
              tip: {
                addProvider: routing.missingProviderHint.provider,
                reason: routing.missingProviderHint.reason,
                savings: routing.missingProviderHint.estimatedSavings,
                signupUrl: routing.missingProviderHint.signupUrl,
              },
            }),
          },
        }),
      });
    } catch (error) {
      logger.error(
        "[Chat] Send error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        {
          error: error instanceof Error ? error.message : "Chat send failed",
        },
        500,
      );
    }
  },
);

/**
 * POST /api/chat/completions
 * Generate a chat completion
 */
chatRoutes.post(
  "/completions",
  zValidator("json", ChatCompletionSchema),
  async (c) => {
    const body = c.req.valid("json");

    // Convert to ChatMessage format
    const messages: ChatMessage[] = body.messages.map((msg) => ({
      id: randomUUID(),
      role: msg.role,
      content: msg.content,
      timestamp: new Date().toISOString(),
    }));

    // Handle streaming
    if (body.stream) {
      // Smart route for streaming too
      let streamRouting: RoutingDecision | undefined;
      let streamModel = body.model;

      if (!body.model && isSmartRouterEnabled()) {
        const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          const providers = new Set(aiProvider.getConfiguredProviders() as ProviderType[]);
          streamRouting = routeQuery(lastUserMsg.content, providers, {
            conversationLength: body.messages.length,
          });
          streamModel = streamRouting.selectedModel.id;
          recordRoutingDecision(streamRouting);
        }
      }

      return streamText(c, async (stream) => {
        try {
          // Send routing info as first event in stream
          if (streamRouting) {
            await stream.write(
              `data: ${JSON.stringify({
                routing: {
                  smartRouted: true,
                  complexity: streamRouting.complexity.tier,
                  savings: `${streamRouting.savingsPercent}%`,
                  model: streamRouting.selectedModel.id,
                  provider: streamRouting.selectedModel.provider,
                },
              })}\n\n`,
            );
          }

          const response = await aiProvider.chatStream(
            {
              messages,
              model: streamModel,
              systemPrompt: body.systemPrompt,
              temperature: body.temperature,
              maxTokens: body.maxTokens,
            },
            (chunk) => {
              // Non-blocking write - fire and forget for speed
              stream
                .write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
                .catch((err) => {
                  logger.error(
                    "[Chat] Stream write error:",
                    err instanceof Error ? err : undefined,
                  );
                });
            },
          );

          // Send final message with usage (this one we await to ensure delivery)
          await stream.write(
            `data: ${JSON.stringify({
              done: true,
              usage: response.usage,
              finishReason: response.finishReason,
            })}\n\n`,
          );
        } catch (error) {
          logger.error(
            "[Chat] Stream error:",
            error instanceof Error ? error : undefined,
          );
          await stream.write(
            `data: ${JSON.stringify({
              error: error instanceof Error ? error.message : "Chat failed",
            })}\n\n`,
          );
        }
      });
    }

    // Non-streaming
    try {
      // Smart routing for completions
      let routing: RoutingDecision | undefined;
      let modelToUse = body.model;

      if (!body.model && isSmartRouterEnabled()) {
        const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          const providers = new Set(aiProvider.getConfiguredProviders() as ProviderType[]);
          routing = routeQuery(lastUserMsg.content, providers, {
            conversationLength: body.messages.length,
          });
          modelToUse = routing.selectedModel.id;
          recordRoutingDecision(routing);
        }
      }

      const response = await aiProvider.chat({
        messages,
        model: modelToUse,
        systemPrompt: body.systemPrompt,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      });

      return c.json({
        id: response.id,
        provider: response.provider,
        model: response.model,
        message: {
          role: "assistant",
          content: response.content,
        },
        finishReason: response.finishReason,
        usage: response.usage,
        duration: response.duration,
        ...(routing && {
          routing: {
            smartRouted: true,
            complexity: routing.complexity.tier,
            savings: `${routing.savingsPercent}%`,
            estimatedCost: `$${routing.estimatedCost.toFixed(4)}`,
            summary: getCostComparison(routing),
          },
        }),
      });
    } catch (error) {
      logger.error(
        "[Chat] Completion error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Chat completion failed",
        },
        500,
      );
    }
  },
);

/**
 * GET /api/chat/models
 * List available models
 */
chatRoutes.get("/models", async (c) => {
  const provider = c.req.query("provider");

  let models;
  if (provider) {
    const providerType = parseProviderType(provider);
    if (!providerType) {
      return c.json({ error: "Invalid provider" }, 400);
    }
    models = aiProvider.getModelsForProvider(providerType);
  } else {
    models = aiProvider.getAllModels();
  }

  // Convert MODEL_ALIASES to API format dynamically
  const aliases = Object.entries(MODEL_ALIASES).map(([alias, config]) => ({
    alias,
    provider: config.provider,
    model: config.model,
  }));

  return c.json({
    models,
    aliases,
  });
});

/**
 * GET /api/chat/providers
 * List configured providers and their status
 */
chatRoutes.get("/providers", async (c) => {
  const configured = aiProvider.getConfiguredProviders();
  const health = await aiProvider.healthCheck();

  return c.json({
    default: aiProvider.getDefaultProvider(),
    providers: configured.map((p) => {
      const h = health.find((h) => h.provider === p);
      return {
        type: p,
        enabled: true,
        healthy: h?.healthy ?? false,
        message: h?.message,
        latencyMs: h?.latencyMs,
      };
    }),
  });
});

/**
 * POST /api/chat/providers/:type/configure
 * Configure a provider (persists to database)
 */
chatRoutes.post(
  "/providers/:type/configure",
  zValidator("json", ProviderConfigSchema),
  async (c) => {
    const type = parseProviderType(c.req.param("type"));
    const config = c.req.valid("json");

    if (!type) {
      return c.json({ error: "Invalid provider" }, 400);
    }

    try {
      // Build provider config (include Azure-specific fields)
      const providerConfig: ProviderConfig = {
        type,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        resourceName: config.resourceName,
        deploymentName: config.deploymentName,
        apiVersion: config.apiVersion,
        defaultModel: config.defaultModel,
        enabled: config.enabled ?? true,
      };

      // Configure in memory
      aiProvider.configure(type, providerConfig);

      // Persist to database (only if we have an API key or baseUrl)
      if (config.apiKey || config.baseUrl) {
        await saveProviderConfig({
          type,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          resourceName: config.resourceName,
          deploymentName: config.deploymentName,
          apiVersion: config.apiVersion,
          defaultModel: config.defaultModel,
          enabled: config.enabled ?? true,
        });
        logger.info(`[Chat] Provider ${type} config saved to database`);
      }

      return c.json({ success: true, message: `${type} configured` });
    } catch (error) {
      logger.error(
        `[Chat] Failed to configure provider ${type}:`,
        error instanceof Error ? error : undefined,
      );
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Configuration failed",
        },
        400,
      );
    }
  },
);

/**
 * POST /api/chat/providers/:type/health
 * Check provider health
 */
chatRoutes.post("/providers/:type/health", async (c) => {
  const type = parseProviderType(c.req.param("type"));

  if (!type) {
    return c.json({ error: "Invalid provider" }, 400);
  }

  const results = await aiProvider.healthCheck(type);
  const result = results[0];

  if (!result) {
    return c.json({ error: "Provider not found" }, 404);
  }

  return c.json(result);
});

/**
 * POST /api/chat/providers/default
 * Set default provider
 */
chatRoutes.post(
  "/providers/default",
  zValidator("json", z.object({ provider: ProviderConfigSchema.shape.type })),
  async (c) => {
    const { provider } = c.req.valid("json");

    try {
      aiProvider.setDefaultProvider(provider);
      return c.json({ success: true, default: provider });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to set default",
        },
        400,
      );
    }
  },
);

/**
 * GET /api/chat/providers/:type/models
 * Fetch available models from a provider (dynamic discovery)
 */
chatRoutes.get("/providers/:type/models", async (c) => {
  const type = c.req.param("type");

  try {
    // For Ollama, fetch from the local API
    if (type === "ollama") {
      const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error("Failed to fetch Ollama models");
      }
      const data = (await response.json()) as {
        models?: Array<{ name: string; size: number; modified_at: string }>;
      };
      return c.json({
        provider: type,
        models: (data.models || []).map((m) => ({
          id: m.name,
          name: m.name,
          size: m.size,
          modifiedAt: m.modified_at,
        })),
      });
    }

    // For OpenRouter, fetch from their API
    if (type === "openrouter") {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return c.json({ error: "OpenRouter not configured" }, 400);
      }
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch OpenRouter models");
      }
      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          name: string;
          pricing?: { prompt: string; completion: string };
        }>;
      };
      return c.json({
        provider: type,
        models: (data.data || []).map((m) => ({
          id: m.id,
          name: m.name || m.id,
          pricing: m.pricing,
        })),
      });
    }

    // For other providers, return static catalog
    const providerType = parseProviderType(type);
    if (!providerType) {
      return c.json({ error: "Invalid provider" }, 400);
    }
    const models = aiProvider.getModelsForProvider(providerType);
    return c.json({ provider: type, models });
  } catch (error) {
    logger.error(
      `[Chat] Failed to fetch models for ${type}:`,
      error instanceof Error ? error : undefined,
    );
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch models",
      },
      500,
    );
  }
});

/**
 * POST /api/chat/quick
 * Quick chat endpoint for simple requests
 */
chatRoutes.post(
  "/quick",
  zValidator(
    "json",
    z.object({
      prompt: z.string(),
      model: z.string().optional(),
      systemPrompt: z.string().optional(),
      temperature: z.number().optional(),
    }),
  ),
  async (c) => {
    const { prompt, model, systemPrompt, temperature } = c.req.valid("json");

    try {
      const response = await aiProvider.chat({
        messages: [
          {
            id: randomUUID(),
            role: "user",
            content: prompt,
            timestamp: new Date().toISOString(),
          },
        ],
        model,
        systemPrompt,
        temperature,
      });

      return c.json({
        content: response.content,
        model: response.model,
        provider: response.provider,
        usage: response.usage,
      });
    } catch (error) {
      logger.error(
        "[Chat] Quick chat error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        {
          error: error instanceof Error ? error.message : "Quick chat failed",
        },
        500,
      );
    }
  },
);

// === Preset & Context Routes ===

/**
 * GET /api/chat/presets
 * List available chat presets
 */
chatRoutes.get("/presets", async (c) => {
  return c.json({
    presets: CHAT_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      examples: p.examples,
    })),
    default: "profclaw-assistant",
  });
});

/**
 * GET /api/chat/quick-actions
 * List quick action suggestions
 */
chatRoutes.get("/quick-actions", async (c) => {
  return c.json({ actions: QUICK_ACTIONS });
});

// === Skills Routes ===

/**
 * GET /api/chat/skills
 * List available chat skills
 */
chatRoutes.get("/skills", async (c) => {
  return c.json({
    skills: CHAT_SKILLS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      icon: s.icon,
      capabilities: s.capabilities,
      preferredModel: s.preferredModel,
      examples: s.examples,
    })),
    modelTiers: MODEL_TIERS.map((t) => ({
      tier: t.tier,
      description: t.description,
      costMultiplier: t.costMultiplier,
    })),
  });
});

/**
 * POST /api/chat/skills/detect
 * Detect intent and match skills for a message
 */
chatRoutes.post(
  "/skills/detect",
  zValidator(
    "json",
    z.object({
      message: z.string(),
      hasTask: z.boolean().optional(),
      hasTicket: z.boolean().optional(),
      hasCode: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const { message, hasTask, hasTicket, hasCode } = c.req.valid("json");

    const matches = detectIntent(message, { hasTask, hasTicket, hasCode });

    return c.json({
      matches: matches.slice(0, 3).map((m) => ({
        skillId: m.skill.id,
        skillName: m.skill.name,
        confidence: m.confidence,
        matchedPattern: m.matchedPattern,
        extractedVars: m.extractedVars,
        preferredModel: m.skill.preferredModel,
      })),
      recommendedSkill: matches[0]
        ? {
            id: matches[0].skill.id,
            name: matches[0].skill.name,
            confidence: matches[0].confidence,
          }
        : null,
    });
  },
);

/**
 * POST /api/chat/skills/route
 * Get recommended model and skill for a message
 */
chatRoutes.post(
  "/skills/route",
  zValidator(
    "json",
    z.object({
      message: z.string(),
      availableModels: z.array(z.string()).optional(),
      hasTask: z.boolean().optional(),
      hasTicket: z.boolean().optional(),
      hasCode: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const { message, availableModels, hasTask, hasTicket, hasCode } =
      c.req.valid("json");

    // Get available models from providers if not specified
    let models = availableModels;
    if (!models || models.length === 0) {
      const allModels = aiProvider.getAllModels();
      models = allModels.map((m) => m.id);
    }

    // Detect intent
    const matches = detectIntent(message, { hasTask, hasTicket, hasCode });
    const bestMatch = matches[0];

    if (!bestMatch) {
      return c.json({
        error: "Could not detect intent",
        fallback: { model: models[0], tier: "balanced" },
      });
    }

    // Select model based on skill and message
    const selection = selectModel(bestMatch, message, models);

    return c.json({
      skill: {
        id: bestMatch.skill.id,
        name: bestMatch.skill.name,
        confidence: bestMatch.confidence,
      },
      model: {
        selected: selection.model,
        tier: selection.tier.tier,
        reason: selection.reason,
        costMultiplier: selection.tier.costMultiplier,
      },
      routing: {
        method: bestMatch.matchedPattern ? "pattern_match" : "fallback",
        pattern: bestMatch.matchedPattern,
      },
    });
  },
);

// === Conversation Routes ===

/**
 * GET /api/chat/conversations
 * List conversations with optional filtering
 */
chatRoutes.get("/conversations", async (c) => {
  const limit = Number(c.req.query("limit")) || 20;
  const offset = Number(c.req.query("offset")) || 0;
  const taskId = c.req.query("taskId");
  const ticketId = c.req.query("ticketId");

  try {
    const result = await listConversations({ limit, offset, taskId, ticketId });
    return c.json(result);
  } catch (error) {
    logger.error(
      "[Chat] List conversations error:",
      error instanceof Error ? error : undefined,
    );
    return c.json({ error: "Failed to list conversations" }, 500);
  }
});

/**
 * GET /api/chat/conversations/recent
 * Get recent conversations with preview
 */
chatRoutes.get("/conversations/recent", async (c) => {
  const limit = Number(c.req.query("limit")) || 10;

  try {
    const conversations = await getRecentConversationsWithPreview(limit);
    return c.json({ conversations });
  } catch (error) {
    logger.error(
      "[Chat] Recent conversations error:",
      error instanceof Error ? error : undefined,
    );
    return c.json({ error: "Failed to get recent conversations" }, 500);
  }
});

/**
 * POST /api/chat/conversations
 * Create a new conversation
 */
chatRoutes.post(
  "/conversations",
  zValidator(
    "json",
    z.object({
      title: z.string().optional(),
      presetId: z.string().optional(),
      taskId: z.string().optional(),
      ticketId: z.string().optional(),
      projectId: z.string().optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");

    try {
      const conversation = await createConversation(body);
      return c.json({ conversation }, 201);
    } catch (error) {
      logger.error(
        "[Chat] Create conversation error:",
        error instanceof Error ? error : undefined,
      );
      return c.json({ error: "Failed to create conversation" }, 500);
    }
  },
);

/**
 * GET /api/chat/conversations/:id
 * Get a conversation with messages
 */
chatRoutes.get("/conversations/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const conversation = await getConversation(id);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const messages = await getConversationMessages(id);
    return c.json({ conversation, messages });
  } catch (error) {
    logger.error(
      "[Chat] Get conversation error:",
      error instanceof Error ? error : undefined,
    );
    return c.json({ error: "Failed to get conversation" }, 500);
  }
});

/**
 * DELETE /api/chat/conversations/:id
 * Delete a conversation
 */
chatRoutes.delete("/conversations/:id", async (c) => {
  const id = c.req.param("id");

  try {
    await deleteConversation(id);
    return c.json({ message: "Conversation deleted" });
  } catch (error) {
    logger.error(
      "[Chat] Delete conversation error:",
      error instanceof Error ? error : undefined,
    );
    return c.json({ error: "Failed to delete conversation" }, 500);
  }
});

/**
 * GET /api/chat/conversations/:id/memory
 * Get memory stats for a conversation
 */
chatRoutes.get("/conversations/:id/memory", async (c) => {
  const id = c.req.param("id");
  const model = c.req.query("model");

  try {
    const conversation = await getConversation(id);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const messages = await getConversationMessages(id);
    const stats = getMemoryStats(messages, model);

    return c.json({
      conversationId: id,
      stats,
      recommendation: stats.needsCompaction
        ? "Conversation will be automatically compacted on next message"
        : stats.usagePercentage > 50
          ? "Approaching context limit, consider starting a new conversation for long discussions"
          : "Memory usage healthy",
    });
  } catch (error) {
    logger.error(
      "[Chat] Memory stats error:",
      error instanceof Error ? error : undefined,
    );
    return c.json({ error: "Failed to get memory stats" }, 500);
  }
});

/**
 * POST /api/chat/conversations/:id/compact
 * Manually trigger compaction for a conversation
 */
chatRoutes.post("/conversations/:id/compact", async (c) => {
  const id = c.req.param("id");
  const model = c.req.query("model");

  try {
    const conversation = await getConversation(id);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const messages = await getConversationMessages(id);
    const result = await compactMessages(messages, model);

    if (!result.wasCompacted) {
      return c.json({
        compacted: false,
        message: "Conversation does not need compaction yet",
        stats: getMemoryStats(messages, model),
      });
    }

    // Note: In a full implementation, we'd save the compacted messages
    // For now, we just return what the compaction would produce
    return c.json({
      compacted: true,
      originalCount: result.originalCount,
      compactedCount: result.compactedCount,
      tokensReduced: result.tokensReduced,
      summary: result.summary,
      stats: getMemoryStats(result.messages, model),
    });
  } catch (error) {
    logger.error(
      "[Chat] Manual compaction error:",
      error instanceof Error ? error : undefined,
    );
    return c.json({ error: "Failed to compact conversation" }, 500);
  }
});

/**
 * DELETE /api/chat/conversations/:id/messages/:messageId
 * Delete a single message from a conversation
 */
chatRoutes.delete("/conversations/:id/messages/:messageId", async (c) => {
  const conversationId = c.req.param("id");
  const messageId = c.req.param("messageId");

  try {
    const conversation = await getConversation(conversationId);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    await deleteMessage(conversationId, messageId);
    return c.json({ success: true });
  } catch (error) {
    logger.error(
      "[Chat] Delete message error:",
      error instanceof Error ? error : undefined,
    );
    return c.json({ error: "Failed to delete message" }, 500);
  }
});

/**
 * GET /api/chat/conversations/:id/export
 * Export a conversation as JSON
 */
chatRoutes.get("/conversations/:id/export", async (c) => {
  const conversationId = c.req.param("id");

  try {
    const conversation = await getConversation(conversationId);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const messages = await getConversationMessages(conversationId);
    return c.json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
      },
      messages,
      exportedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      "[Chat] Export conversation error:",
      error instanceof Error ? error : undefined,
    );
    return c.json({ error: "Failed to export conversation" }, 500);
  }
});

/**
 * POST /api/chat/conversations/:id/messages
 * Send a message in a conversation (with context and history)
 */
chatRoutes.post(
  "/conversations/:id/messages",
  chatRateLimiter,
  zValidator(
    "json",
    z.object({
      content: z.string(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      stream: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const conversationId = c.req.param("id");
    const body = c.req.valid("json");

    try {
      // Get conversation and build context
      const conversation = await getConversation(conversationId);
      if (!conversation) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      // Build context from linked entities
      const context: ChatContext = {};
      const client = getClient();

      if (conversation.taskId) {
        const taskResult = await client.execute({
          sql: `SELECT id, description, status, assigned_agent as agent FROM tasks WHERE id = ?`,
          args: [conversation.taskId],
        });
        if (taskResult.rows.length > 0) {
          const t = taskResult.rows[0];
          context.task = {
            id: t.id as string,
            title: ((t.description as string) || "").slice(0, 100),
            description: t.description as string,
            status: t.status as string,
            agent: t.agent as string | undefined,
          };
        }
      }

      if (conversation.ticketId) {
        const ticketResult = await client.execute({
          sql: `SELECT id, title, description, status FROM tickets WHERE id = ?`,
          args: [conversation.ticketId],
        });
        if (ticketResult.rows.length > 0) {
          const t = ticketResult.rows[0];
          context.ticket = {
            id: t.id as string,
            title: t.title as string,
            description: t.description as string | undefined,
            status: t.status as string,
          };
        }
      }

      // Get recent activity for context
      const statsResult = await client.execute(`
        SELECT
          (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed,
          (SELECT COUNT(*) FROM tasks WHERE status = 'pending') as pending
      `);
      const stats = statsResult.rows[0];
      context.recentActivity = {
        tasksCompleted: Number(stats.completed) || 0,
        tasksPending: Number(stats.pending) || 0,
        activeAgents: [],
      };

      // Add runtime info (model awareness like OpenClaw)
      const sessionOverride = getSessionModel(conversationId);
      // Use the auto-selected default provider when no model specified
      const defaultProvider = aiProvider.getDefaultProvider();
      const resolvedRef = aiProvider.resolveModel(
        sessionOverride || body.model || defaultProvider,
      );
      context.runtime = {
        model: `${resolvedRef.provider}/${resolvedRef.model}`,
        provider: resolvedRef.provider,
        defaultModel: `${defaultProvider}/${resolvedRef.model}`,
        conversationId,
        sessionOverride,
      };

      // Build system prompt with context
      const systemPrompt = await buildSystemPrompt(
        conversation.presetId,
        context,
      );

      // Get existing messages
      const existingMessages = await getConversationMessages(conversationId);

      // Save user message first
      const userMessage = await addMessage({
        conversationId,
        role: "user",
        content: body.content,
      });

      // Add user message to list for compaction check
      const allMessages: ConversationMessage[] = [
        ...existingMessages,
        {
          id: userMessage.id,
          conversationId,
          role: "user",
          content: body.content,
          createdAt: userMessage.createdAt,
        },
      ];

      // Check if compaction is needed and compact if necessary
      let messagesToSend = allMessages;
      let compactionInfo = null;

      if (needsCompaction(allMessages, body.model)) {
        logger.info(
          `[Chat] Compacting conversation ${conversationId} (${allMessages.length} messages)`,
        );
        const compactionResult = await compactMessages(allMessages, body.model);

        if (compactionResult.wasCompacted) {
          messagesToSend = compactionResult.messages;
          compactionInfo = {
            originalCount: compactionResult.originalCount,
            compactedCount: compactionResult.compactedCount,
            tokensReduced: compactionResult.tokensReduced,
          };
          logger.info(
            `[Chat] Compaction complete: ${compactionResult.originalCount} -> ${compactionResult.compactedCount} messages, ${compactionResult.tokensReduced} tokens saved`,
          );
        }
      }

      // Build chat messages array from (potentially compacted) messages
      const chatMessages: ChatMessage[] = messagesToSend.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.createdAt,
      }));

      // Streaming branch
      if (body.stream) {
        return streamText(c, async (stream) => {
          try {
            let fullContent = "";

            const response = await aiProvider.chatStream(
              {
                messages: chatMessages,
                model: body.model,
                systemPrompt,
                temperature: body.temperature,
              },
              (chunk) => {
                fullContent += chunk;
                stream
                  .write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
                  .catch((err) => {
                    logger.error(
                      "[Chat] Stream write error:",
                      err instanceof Error ? err : undefined,
                    );
                  });
              },
            );

            // Save assistant response after streaming completes
            const assistantMessage = await addMessage({
              conversationId,
              role: "assistant",
              content: fullContent || response.content,
              model: response.model,
              provider: response.provider,
              tokenUsage: response.usage
                ? {
                    prompt: response.usage.promptTokens,
                    completion: response.usage.completionTokens,
                    total: response.usage.totalTokens,
                  }
                : undefined,
              cost: response.usage?.cost,
            });

            await stream.write(
              `data: ${JSON.stringify({
                done: true,
                usage: response.usage,
                messageId: assistantMessage.id,
                compaction: compactionInfo,
              })}\n\n`,
            );
          } catch (error) {
            logger.error(
              "[Chat] Conversation stream error:",
              error instanceof Error ? error : undefined,
            );
            await stream.write(
              `data: ${JSON.stringify({
                error: error instanceof Error ? error.message : "Failed to send message",
              })}\n\n`,
            );
          }
        });
      }

      // Send to AI (non-streaming)
      const response = await aiProvider.chat({
        messages: chatMessages,
        model: body.model,
        systemPrompt,
        temperature: body.temperature,
      });

      // Save assistant response
      const assistantMessage = await addMessage({
        conversationId,
        role: "assistant",
        content: response.content,
        model: response.model,
        provider: response.provider,
        tokenUsage: response.usage
          ? {
              prompt: response.usage.promptTokens,
              completion: response.usage.completionTokens,
              total: response.usage.totalTokens,
            }
          : undefined,
        cost: response.usage?.cost,
      });

      return c.json({
        userMessage,
        assistantMessage: {
          ...assistantMessage,
          model: response.model,
          provider: response.provider,
        },
        usage: response.usage,
        compaction: compactionInfo,
      });
    } catch (error) {
      logger.error(
        "[Chat] Conversation message error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to send message",
        },
        500,
      );
    }
  },
);

/**
 * POST /api/chat/conversations/:id/messages/with-tools
 * Send a message in a conversation with native tool calling enabled
 */
chatRoutes.post(
  "/conversations/:id/messages/with-tools",
  chatRateLimiter,
  zValidator(
    "json",
    z.object({
      content: z.string(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      enableTools: z.boolean().optional().default(true),
    }),
  ),
  async (c) => {
    const conversationId = c.req.param("id");
    const body = c.req.valid("json");

    try {
      // Get conversation and build context
      const conversation = await getConversation(conversationId);
      if (!conversation) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      // Build context from linked entities
      const context: ChatContext = {};
      const client = getClient();

      if (conversation.taskId) {
        const taskResult = await client.execute({
          sql: `SELECT id, description, status, assigned_agent as agent FROM tasks WHERE id = ?`,
          args: [conversation.taskId],
        });
        if (taskResult.rows.length > 0) {
          const t = taskResult.rows[0];
          context.task = {
            id: t.id as string,
            title: ((t.description as string) || "").slice(0, 100),
            description: t.description as string,
            status: t.status as string,
            agent: t.agent as string | undefined,
          };
        }
      }

      if (conversation.ticketId) {
        const ticketResult = await client.execute({
          sql: `SELECT id, title, description, status FROM tickets WHERE id = ?`,
          args: [conversation.ticketId],
        });
        if (ticketResult.rows.length > 0) {
          const t = ticketResult.rows[0];
          context.ticket = {
            id: t.id as string,
            title: t.title as string,
            description: t.description as string | undefined,
            status: t.status as string,
          };
        }
      }

      // Get recent activity for context
      const statsResult = await client.execute(`
        SELECT
          (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed,
          (SELECT COUNT(*) FROM tasks WHERE status = 'pending') as pending
      `);
      const stats = statsResult.rows[0];
      context.recentActivity = {
        tasksCompleted: Number(stats.completed) || 0,
        tasksPending: Number(stats.pending) || 0,
        activeAgents: [],
      };

      // Add runtime info (model awareness like OpenClaw)
      const sessionOverride = getSessionModel(conversationId);
      // Use the auto-selected default provider when no model specified
      const defaultProvider = aiProvider.getDefaultProvider();
      const resolvedRef = aiProvider.resolveModel(
        sessionOverride || body.model || defaultProvider,
      );
      context.runtime = {
        model: `${resolvedRef.provider}/${resolvedRef.model}`,
        provider: resolvedRef.provider,
        defaultModel: `${defaultProvider}/${resolvedRef.model}`,
        conversationId,
        sessionOverride,
      };

      // Get available tools - model-aware when model ID is known
      const enableTools = body.enableTools ?? true;
      const modelId = resolvedRef.model;
      const tools = enableTools
        ? getChatToolsForModel(modelId, { conversationId })
        : [];

      logger.info(`[Chat] Tools for ${modelId}: ${tools.length} (enableTools=${enableTools})`, {
        component: 'Chat',
        toolNames: tools.map(t => t.name).join(', '),
      });

      // Build system prompt with context and tool mode
      const systemPrompt = await buildSystemPrompt(
        conversation.presetId,
        context,
        {
          enableTools: enableTools && tools.length > 0,
        },
      );

      // Get existing messages
      const existingMessages = await getConversationMessages(conversationId);

      // Save user message first
      const userMessage = await addMessage({
        conversationId,
        role: "user",
        content: body.content,
      });

      // Add user message to list for API call
      const allMessages: ConversationMessage[] = [
        ...existingMessages,
        {
          id: userMessage.id,
          conversationId,
          role: "user",
          content: body.content,
          createdAt: userMessage.createdAt,
        },
      ];

      // Check if compaction is needed
      let messagesToSend = allMessages;
      let compactionInfo = null;

      if (needsCompaction(allMessages, body.model)) {
        logger.info(
          `[Chat] Compacting conversation ${conversationId} (${allMessages.length} messages)`,
        );
        const compactionResult = await compactMessages(allMessages, body.model);

        if (compactionResult.wasCompacted) {
          messagesToSend = compactionResult.messages;
          compactionInfo = {
            originalCount: compactionResult.originalCount,
            compactedCount: compactionResult.compactedCount,
            tokensReduced: compactionResult.tokensReduced,
          };
        }
      }

      // Build chat messages array
      const chatMessages: ChatMessage[] = messagesToSend.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.createdAt,
      }));

      // Create tool handler for this conversation
      const toolHandler = await createChatToolHandler({
        conversationId,
        securityMode: "ask",
      });

      // Send to AI with native tool support
      const response = await aiProvider.chatWithNativeTools({
        messages: chatMessages,
        model: body.model,
        systemPrompt,
        temperature: body.temperature,
        tools,
        onToolCall: async (
          toolName: string,
          args: unknown,
          toolCallId: string,
        ) => {
          return toolHandler.executeTool(toolName, args, toolCallId);
        },
        maxToolRoundtrips: 5,
      });

      // Get any pending approvals
      const pendingApprovals = toolHandler.getPendingApprovals();

      const inferToolCallStatus = (
        result: unknown,
      ): "success" | "error" | "pending" => {
        if (!result || typeof result !== "object") {
          return "success";
        }

        const record = result as Record<string, unknown>;
        if (record.pending === true) {
          return "pending";
        }

        if (record.success === false || record.error) {
          return "error";
        }

        return "success";
      };

      // Build toolCalls array for storage
      const toolCallsForStorage = response.toolCalls?.map(
        (tc: NativeToolCall) => {
          const toolResult = response.toolResults?.find(
            (tr: NativeToolResult) => tr.toolCallId === tc.id,
          )?.result;

          return {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            result: toolResult,
            status: inferToolCallStatus(toolResult),
          };
        },
      );

      // Save assistant response with toolCalls
      const assistantMessage = await addMessage({
        conversationId,
        role: "assistant",
        content: response.content,
        model: response.model,
        provider: response.provider,
        tokenUsage: response.usage
          ? {
              prompt: response.usage.promptTokens,
              completion: response.usage.completionTokens,
              total: response.usage.totalTokens,
            }
          : undefined,
        cost: response.usage?.cost,
        toolCalls: toolCallsForStorage,
      });

      return c.json({
        userMessage,
        assistantMessage: {
          ...assistantMessage,
          model: response.model,
          provider: response.provider,
        },
        usage: response.usage,
        compaction: compactionInfo,
        toolCalls: toolCallsForStorage,
        pendingApprovals:
          pendingApprovals.length > 0
            ? pendingApprovals.map((a) => ({
                id: a.id,
                toolName: a.toolName,
                params: a.params,
                securityLevel: "moderate" as const,
              }))
            : undefined,
        // Tool support info for UI warnings
        toolSupport: response.toolSupport,
      });
    } catch (error) {
      logger.error(
        "[Chat] Conversation message with tools error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to send message",
        },
        500,
      );
    }
  },
);

/**
 * POST /api/chat/smart
 * Smart chat with automatic context injection
 * (Simpler alternative to conversation-based chat)
 */
chatRoutes.post(
  "/smart",
  zValidator(
    "json",
    z.object({
      messages: z.array(ChatMessageSchema),
      model: z.string().optional(),
      presetId: z.string().optional(),
      taskId: z.string().optional(),
      ticketId: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");

    try {
      // Build context
      const context: ChatContext = {};
      const client = getClient();

      if (body.taskId) {
        const taskResult = await client.execute({
          sql: `SELECT id, description, status, assigned_agent as agent FROM tasks WHERE id = ?`,
          args: [body.taskId],
        });
        if (taskResult.rows.length > 0) {
          const t = taskResult.rows[0];
          context.task = {
            id: t.id as string,
            title: ((t.description as string) || "").slice(0, 100),
            description: t.description as string,
            status: t.status as string,
            agent: t.agent as string | undefined,
          };
        }
      }

      if (body.ticketId) {
        const ticketResult = await client.execute({
          sql: `SELECT id, title, description, status FROM tickets WHERE id = ?`,
          args: [body.ticketId],
        });
        if (ticketResult.rows.length > 0) {
          const t = ticketResult.rows[0];
          context.ticket = {
            id: t.id as string,
            title: t.title as string,
            description: t.description as string | undefined,
            status: t.status as string,
          };
        }
      }

      // Build system prompt
      const systemPrompt = await buildSystemPrompt(
        body.presetId || "profclaw-assistant",
        context,
      );

      // Convert messages
      const messages: ChatMessage[] = body.messages.map((msg) => ({
        id: randomUUID(),
        role: msg.role,
        content: msg.content,
        timestamp: new Date().toISOString(),
      }));

      // Send to AI
      const response = await aiProvider.chat({
        messages,
        model: body.model,
        systemPrompt,
        temperature: body.temperature,
      });

      return c.json({
        id: response.id,
        provider: response.provider,
        model: response.model,
        message: {
          role: "assistant",
          content: response.content,
        },
        finishReason: response.finishReason,
        usage: response.usage,
        duration: response.duration,
        context: {
          presetId: body.presetId || "profclaw-assistant",
          taskId: body.taskId,
          ticketId: body.ticketId,
        },
      });
    } catch (error) {
      logger.error(
        "[Chat] Smart chat error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        { error: error instanceof Error ? error.message : "Smart chat failed" },
        500,
      );
    }
  },
);

// Chat with Tools

/**
 * POST /api/chat/with-tools
 * Chat with AI tools enabled (file operations, git, system info, etc.)
 */
chatRoutes.post(
  "/with-tools",
  zValidator(
    "json",
    z.object({
      messages: z.array(ChatMessageSchema),
      conversationId: z.string().optional(),
      model: z.string().optional(),
      systemPrompt: z.string().optional(),
      presetId: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      enableAllTools: z.boolean().optional(), // Enable all tools vs safe subset
      securityMode: z
        .enum(["deny", "sandbox", "allowlist", "ask", "full"])
        .optional(),
      workdir: z.string().optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const conversationId = body.conversationId || randomUUID();

    try {
      // Create tool handler with security settings
      const toolHandler = await createChatToolHandler({
        conversationId,
        workdir: body.workdir,
        securityMode: body.securityMode || "ask",
      });

      // Get tools based on user preference
      const tools = body.enableAllTools
        ? getAllChatTools()
        : getDefaultChatTools();

      // Build system prompt with tools enabled (this endpoint always has tools)
      let systemPrompt = body.systemPrompt || "";
      if (body.presetId) {
        systemPrompt =
          (await buildSystemPrompt(body.presetId, {}, { enableTools: true })) +
          "\n\n" +
          systemPrompt;
      } else if (!systemPrompt) {
        // Even without preset, add tool-enabled system prompt
        systemPrompt = await buildSystemPrompt(
          "profclaw-assistant",
          {},
          { enableTools: true },
        );
      }

      // Convert messages
      const messages: ChatMessage[] = body.messages.map((msg) => ({
        id: randomUUID(),
        role: msg.role,
        content: msg.content,
        timestamp: new Date().toISOString(),
      }));

      // Call AI with native tool support
      const response = await aiProvider.chatWithNativeTools({
        messages,
        model: body.model,
        systemPrompt,
        temperature: body.temperature,
        tools,
        onToolCall: async (
          toolName: string,
          args: unknown,
          toolCallId: string,
        ) => {
          return toolHandler.executeTool(toolName, args, toolCallId);
        },
        maxToolRoundtrips: 5,
      });

      // Check for pending approvals
      const pendingApprovals = toolHandler.getPendingApprovals();

      return c.json({
        id: response.id,
        conversationId,
        provider: response.provider,
        model: response.model,
        message: {
          role: "assistant",
          content: response.content,
        },
        finishReason: response.finishReason,
        usage: response.usage,
        duration: response.duration,
        // Tool execution info
        toolCalls: response.toolCalls,
        toolResults: response.toolResults,
        pendingApprovals:
          pendingApprovals.length > 0 ? pendingApprovals : undefined,
        steps: response.steps,
        // Tool support info for UI warnings
        toolSupport: response.toolSupport,
      });
    } catch (error) {
      logger.error(
        "[Chat] Chat with tools error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Chat with tools failed",
        },
        500,
      );
    }
  },
);

/**
 * POST /api/chat/conversations/:id/messages/agentic
 * Send a message in agentic mode with SSE streaming for real-time updates.
 *
 * This endpoint runs the AI in autonomous mode, executing multiple tools
 * until the task is complete. Events are streamed via SSE including:
 * - session:start - Agent session started
 * - thinking:start/update/end - AI reasoning (if enabled)
 * - step:start/complete - Step progress
 * - tool:call - Tool being called
 * - tool:result - Tool execution result
 * - summary - Final task summary
 * - complete - Session complete
 * - error - Error occurred
 */
chatRoutes.post(
  "/conversations/:id/messages/agentic",
  chatRateLimiter,
  zValidator(
    "json",
    z.object({
      content: z.string(),
      model: z.string().optional(),
      provider: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      showThinking: z.boolean().optional().default(true),
      maxSteps: z.number().min(1).max(200).optional(),
      maxBudget: z.number().min(1000).optional(),
      effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
    }),
  ),
  async (c) => {
    const conversationId = c.req.param("id");
    const body = c.req.valid("json");

    try {
      // Get conversation
      const conversation = await getConversation(conversationId);
      if (!conversation) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      // Build context from linked entities
      const context: ChatContext = {};
      const client = getClient();

      if (conversation.taskId) {
        const taskResult = await client.execute({
          sql: `SELECT id, description, status, assigned_agent as agent FROM tasks WHERE id = ?`,
          args: [conversation.taskId],
        });
        if (taskResult.rows.length > 0) {
          const t = taskResult.rows[0];
          context.task = {
            id: t.id as string,
            title: ((t.description as string) || "").slice(0, 100),
            description: t.description as string,
            status: t.status as string,
            agent: t.agent as string | undefined,
          };
        }
      }

      if (conversation.ticketId) {
        const ticketResult = await client.execute({
          sql: `SELECT id, title, description, status FROM tickets WHERE id = ?`,
          args: [conversation.ticketId],
        });
        if (ticketResult.rows.length > 0) {
          const t = ticketResult.rows[0];
          context.ticket = {
            id: t.id as string,
            title: t.title as string,
            description: t.description as string | undefined,
            status: t.status as string,
          };
        }
      }

      // Add runtime info
      const sessionOverride = getSessionModel(conversationId);
      const defaultProvider = aiProvider.getDefaultProvider();
      const resolvedRef = aiProvider.resolveModel(
        sessionOverride || body.model || defaultProvider,
      );
      context.runtime = {
        model: `${resolvedRef.provider}/${resolvedRef.model}`,
        provider: resolvedRef.provider,
        defaultModel: `${defaultProvider}/${resolvedRef.model}`,
        conversationId,
        sessionOverride,
      };

      // Build system prompt with agent mode (uses AGENT_MODE_SUFFIX)
      const systemPrompt = await buildSystemPrompt(conversation.presetId, context, {
        agentMode: true,
      });

      // Get existing messages
      const existingMessages = await getConversationMessages(conversationId);

      // Save user message first
      const userMessage = await addMessage({
        conversationId,
        role: "user",
        content: body.content,
      });

      // Build all messages for compaction check
      const allMessages: ConversationMessage[] = [
        ...existingMessages,
        {
          id: userMessage.id,
          conversationId,
          role: "user",
          content: body.content,
          createdAt: userMessage.createdAt,
        },
      ];

      // Apply context pruning if conversation is getting long
      let messagesToSend = allMessages;
      let compactionApplied = false;

      if (needsCompaction(allMessages, body.model)) {
        logger.info(
          `[Chat/Agentic] Compacting conversation ${conversationId} (${allMessages.length} messages)`,
        );
        const compactionResult = await compactMessages(allMessages, body.model);

        if (compactionResult.wasCompacted) {
          messagesToSend = compactionResult.messages;
          compactionApplied = true;
          logger.info(
            `[Chat/Agentic] Compaction complete: ${compactionResult.originalCount} -> ${compactionResult.compactedCount} messages, ${compactionResult.tokensReduced} tokens saved`,
          );
        }
      }

      // Build chat messages from (potentially compacted) messages
      const chatMessages: ChatMessage[] = messagesToSend.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.createdAt,
      }));

      // Create tool handler (triggers tool registration if first call)
      const toolHandler = await createChatToolHandler({
        conversationId,
        securityMode: "full", // Full access in agentic mode (tools are pre-approved)
      });

      // Get tools AFTER handler init (registry is now populated)
      const tools = getChatToolsForModel(resolvedRef.model, { conversationId });
      logger.info(`[Chat/Agentic] Tools for model ${resolvedRef.model}: ${tools.length}`);

      // Set up SSE streaming response
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      c.header("X-Accel-Buffering", "no");

      return streamText(c, async (stream) => {
        // Overall timeout for the agentic session (3 minutes)
        const AGENTIC_TIMEOUT_MS = 3 * 60 * 1000;
        let timedOut = false;
        const timeoutId = setTimeout(async () => {
          timedOut = true;
          logger.warn("[Chat/Agentic] Session timed out", {
            conversationId,
            timeoutMs: AGENTIC_TIMEOUT_MS,
          });
          try {
            await stream.write(
              `data: ${JSON.stringify({
                type: "error",
                data: {
                  message: "Agentic session timed out after 3 minutes. The task may be too complex — try breaking it into smaller steps.",
                  code: "TIMEOUT",
                },
                timestamp: Date.now(),
              })}\n\n`,
            );
          } catch {
            // Stream may already be closed
          }
        }, AGENTIC_TIMEOUT_MS);

        // Send initial event with user message and compaction info
        await stream.write(
          `data: ${JSON.stringify({
            type: "user_message",
            data: {
              id: userMessage.id,
              content: body.content,
              compactionApplied,
              messageCount: messagesToSend.length,
            },
            timestamp: Date.now(),
          })}\n\n`,
        );

        let lastAssistantContent = "";
        let totalTokens = 0;
        let inputTokensTotal: number | undefined;
        let outputTokensTotal: number | undefined;
        let finalModel = "";
        let finalProvider = "";
        let collectedToolCalls: Array<{
          id: string;
          name: string;
          arguments: Record<string, unknown>;
          result?: unknown;
          status: "success" | "error";
        }> = [];

        try {
          // Run the streaming agentic chat
          for await (const event of streamAgenticChat({
            conversationId,
            messages: chatMessages,
            systemPrompt,
            model: body.model,
            provider: body.provider,
            temperature: body.temperature,
            toolHandler,
            tools: (() => {
              const mapped = tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              }));
              logger.info(`[Chat/Agentic] Sending ${mapped.length} tools: [${mapped.map(t => t.name).join(', ')}]`);
              return mapped;
            })(),
            showThinking: body.showThinking,
            maxSteps: body.maxSteps,
            maxBudget: body.maxBudget,
            effort: body.effort,
          })) {
            // Check if we've timed out
            if (timedOut) break;

            // Stream each event to the client
            await stream.write(`data: ${JSON.stringify(event)}\n\n`);

            // Track data for final message save
            if (event.type === "summary") {
              const summaryData = event.data as { summary: string };
              lastAssistantContent = summaryData.summary;
            }
            if (event.type === "complete") {
              const completeData = event.data as {
                totalTokens: number;
                inputTokens?: number;
                outputTokens?: number;
                model: string;
                provider: string;
                toolCalls?: Array<{
                  id: string;
                  name: string;
                  arguments: Record<string, unknown>;
                  result?: unknown;
                  status: "success" | "error";
                }>;
              };
              totalTokens = completeData.totalTokens;
              inputTokensTotal = completeData.inputTokens;
              outputTokensTotal = completeData.outputTokens;
              finalModel = completeData.model;
              finalProvider = completeData.provider;
              collectedToolCalls = completeData.toolCalls || [];
            }
          }

          // Clear the timeout - we completed normally
          clearTimeout(timeoutId);

          // Save assistant response after streaming completes
          if (lastAssistantContent) {
            const promptTokens = inputTokensTotal ?? Math.floor(totalTokens * 0.7);
            const completionTokens = outputTokensTotal ?? (totalTokens - promptTokens);

            const assistantMessage = await addMessage({
              conversationId,
              role: "assistant",
              content: lastAssistantContent,
              model: finalModel,
              provider: finalProvider,
              tokenUsage:
                totalTokens > 0
                  ? {
                      prompt: promptTokens,
                      completion: completionTokens,
                      total: totalTokens,
                    }
                  : undefined,
              toolCalls:
                collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
            });

            // Track in-memory usage for cost dashboard
            if (totalTokens > 0 && finalModel) {
              trackChatUsage(finalModel, totalTokens, inputTokensTotal, outputTokensTotal);
            }

            // Send final saved message event
            await stream.write(
              `data: ${JSON.stringify({
                type: "message_saved",
                data: { id: assistantMessage.id },
                timestamp: Date.now(),
              })}\n\n`,
            );
          }
        } catch (error) {
          clearTimeout(timeoutId);
          logger.error(
            "[Chat] Agentic streaming error:",
            error instanceof Error ? error : undefined,
          );
          await stream.write(
            `data: ${JSON.stringify({
              type: "error",
              data: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Agentic execution failed",
              },
              timestamp: Date.now(),
            })}\n\n`,
          );
        }
      });
    } catch (error) {
      logger.error(
        "[Chat] Agentic chat setup error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to start agentic chat",
        },
        500,
      );
    }
  },
);

/**
 * GET /api/chat/tools
 * List available tools for chat
 */
chatRoutes.get("/tools", async (c) => {
  const allTools = c.req.query("all") === "true";

  const tools = allTools ? getAllChatTools() : getDefaultChatTools();

  return c.json({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
    })),
    total: tools.length,
    mode: allTools ? "all" : "default",
  });
});

/**
 * POST /api/chat/tools/approve
 * Approve a pending tool execution
 */
chatRoutes.post(
  "/tools/approve",
  zValidator(
    "json",
    z.object({
      conversationId: z.string(),
      approvalId: z.string(),
      decision: z.enum(["allow-once", "allow-always", "deny"]),
    }),
  ),
  async (c) => {
    const { conversationId, approvalId, decision } = c.req.valid("json");

    try {
      // Create handler for this conversation to access approvals
      const toolHandler = await createChatToolHandler({ conversationId });

      const result = await toolHandler.handleApproval(approvalId, decision);

      if (!result) {
        return c.json({ error: "Approval not found or expired" }, 404);
      }

      return c.json({
        success: true,
        result: result.result,
        decision,
      });
    } catch (error) {
      logger.error(
        "[Chat] Tool approval error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        { error: error instanceof Error ? error.message : "Approval failed" },
        500,
      );
    }
  },
);

// Group Chat Routes

/**
 * GET /api/chat/group/config
 * Get group chat configuration and channel personalities
 */
chatRoutes.get("/group/config", (c) => {
  const manager = getGroupChatManager();
  return c.json({
    mentionGating: true,
    threadingEnabled: true,
    rateLimiting: true,
    channelPersonalities: manager.getChannelPersonalities(),
  });
});

/**
 * POST /api/chat/group/personality
 * Set a channel-specific system prompt
 */
chatRoutes.post(
  "/group/personality",
  zValidator(
    "json",
    z.object({
      channelId: z.string().min(1),
      systemPrompt: z.string().min(1),
    }),
  ),
  async (c) => {
    const { channelId, systemPrompt } = c.req.valid("json");

    try {
      const manager = getGroupChatManager();
      manager.setChannelPersonality(channelId, systemPrompt);
      return c.json({ success: true });
    } catch (error) {
      logger.error(
        "[Chat/Group] Set personality error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to set personality" },
        500,
      );
    }
  },
);

/**
 * POST /api/chat/group/rate-limit
 * Configure the per-minute rate limit for a channel
 */
chatRoutes.post(
  "/group/rate-limit",
  zValidator(
    "json",
    z.object({
      channelId: z.string().min(1),
      maxPerMinute: z.number().int().positive(),
    }),
  ),
  async (c) => {
    const { channelId, maxPerMinute } = c.req.valid("json");

    try {
      const manager = getGroupChatManager();
      manager.setRateLimit(channelId, maxPerMinute);
      return c.json({ success: true });
    } catch (error) {
      logger.error(
        "[Chat/Group] Set rate limit error:",
        error instanceof Error ? error : undefined,
      );
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to set rate limit" },
        500,
      );
    }
  },
);

export { chatRoutes };
