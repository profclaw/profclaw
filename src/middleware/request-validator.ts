/**
 * Request Validation Middleware
 *
 * Zod-based body validation for critical API endpoints.
 * Returns structured 400 errors with field-level details.
 */

import { type Context, type Next } from 'hono';
import { z } from 'zod';

// ─── Schemas ─────────────────────────────────────────────────────────────────

/**
 * POST /api/chat/quick
 */
export const ChatQuickSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  model: z.string().max(100).optional(),
  provider: z.string().max(50).optional(),
  systemPrompt: z.string().max(10_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

/**
 * POST /api/chat/conversations/:id/messages
 */
export const ChatMessageSchema = z.object({
  content: z.string().min(1).max(100_000),
  model: z.string().max(100).optional(),
  provider: z.string().max(50).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

/**
 * POST /api/chat/conversations
 */
export const CreateConversationSchema = z.object({
  mode: z.enum(['chat', 'agentic']).optional(),
  presetId: z.string().max(100).optional(),
  title: z.string().max(200).optional(),
  taskId: z.string().max(100).optional(),
  ticketId: z.string().max(100).optional(),
  projectId: z.string().max(100).optional(),
});

/**
 * POST /api/tasks
 */
export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  input: z.string().min(1).max(100_000).optional(),
  priority: z.number().int().min(1).max(10).optional(),
});

/**
 * POST /api/gateway/execute-secure
 */
export const GatewayExecuteSchema = z.object({
  task: z.object({
    id: z.string().max(100).optional(),
    title: z.string().min(1).max(500).optional(),
    input: z.string().max(100_000).optional(),
  }),
  preferredAgent: z.string().max(100).optional(),
  workflow: z.string().max(50).optional(),
  timeoutMs: z.number().int().min(0).max(600_000).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  autonomous: z.boolean().optional(),
  context: z.record(z.unknown()).optional(),
});

// ─── Exported schema types ────────────────────────────────────────────────────

export type ChatQuickInput = z.infer<typeof ChatQuickSchema>;
export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type GatewayExecuteInput = z.infer<typeof GatewayExecuteSchema>;

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Creates a Hono middleware that validates the JSON request body against a Zod schema.
 *
 * On success the parsed data is stored at `c.get('validatedBody')`.
 * On failure a structured 400 is returned with per-field error details.
 *
 * Usage:
 *   app.post('/api/chat/quick', validateBody(ChatQuickSchema), async (c) => {
 *     const body = c.get('validatedBody') as ChatQuickInput;
 *   });
 */
export function validateBody<T>(schema: z.ZodSchema<T>) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const body = await c.req.json().catch(() => null) as unknown;

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const result = schema.safeParse(body);

    if (!result.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: result.error.flatten().fieldErrors,
        },
        400,
      );
    }

    c.set('validatedBody', result.data);
    await next();
  };
}
