import { z } from 'zod';

/**
 * Claude Code Hook Schemas
 *
 * These schemas define the payloads sent by Claude Code hooks.
 * Hooks are zero-cost integration points that don't burn tokens.
 *
 * Reference: https://docs.anthropic.com/claude-code/hooks
 */

// Tool input schemas for different tool types
const EditToolInputSchema = z.object({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

const WriteToolInputSchema = z.object({
  file_path: z.string(),
  content: z.string(),
});

const ReadToolInputSchema = z.object({
  file_path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

const BashToolInputSchema = z.object({
  command: z.string(),
  description: z.string().optional(),
  timeout: z.number().optional(),
});

const GlobToolInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

const GrepToolInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
});

// Generic tool input for unknown tools
const GenericToolInputSchema = z.record(z.unknown());

// Tool output schema
const ToolOutputSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
  content: z.string().optional(),
}).passthrough();

// Base hook payload
const BaseHookPayloadSchema = z.object({
  timestamp: z.string().datetime().optional(),
  session_id: z.string().optional(),
  working_directory: z.string().optional(),
});

/**
 * PostToolUse Hook Schema
 *
 * Sent after Claude Code uses any tool (Edit, Write, Bash, etc.)
 */
export const PostToolUsePayloadSchema = BaseHookPayloadSchema.extend({
  event: z.literal('PostToolUse'),
  tool: z.string(),
  input: z.union([
    EditToolInputSchema,
    WriteToolInputSchema,
    ReadToolInputSchema,
    BashToolInputSchema,
    GlobToolInputSchema,
    GrepToolInputSchema,
    GenericToolInputSchema,
  ]),
  output: ToolOutputSchema.optional(),
});

/**
 * Stop Hook Schema (Session End)
 *
 * Sent when a Claude Code session ends
 */
export const SessionEndPayloadSchema = BaseHookPayloadSchema.extend({
  event: z.literal('Stop'),
  reason: z.enum(['completed', 'cancelled', 'error', 'timeout']).optional(),
  summary: z.string().optional(),
  files_changed: z.array(z.string()).optional(),
  duration_ms: z.number().optional(),
});

/**
 * UserPromptSubmit Hook Schema
 *
 * Sent when user submits a prompt to Claude Code
 */
export const UserPromptSubmitPayloadSchema = BaseHookPayloadSchema.extend({
  event: z.literal('UserPromptSubmit'),
  prompt: z.string(),
  context: z.object({
    file: z.string().optional(),
    selection: z.string().optional(),
    repository: z.string().optional(),
    branch: z.string().optional(),
  }).optional(),
});

/**
 * Union of all hook payloads
 */
export const HookPayloadSchema = z.discriminatedUnion('event', [
  PostToolUsePayloadSchema,
  SessionEndPayloadSchema,
  UserPromptSubmitPayloadSchema,
]);

// Export types
export type PostToolUsePayload = z.infer<typeof PostToolUsePayloadSchema>;
export type SessionEndPayload = z.infer<typeof SessionEndPayloadSchema>;
export type UserPromptSubmitPayload = z.infer<typeof UserPromptSubmitPayloadSchema>;
export type HookPayload = z.infer<typeof HookPayloadSchema>;

// Tool-specific input types
export type EditToolInput = z.infer<typeof EditToolInputSchema>;
export type WriteToolInput = z.infer<typeof WriteToolInputSchema>;
export type ReadToolInput = z.infer<typeof ReadToolInputSchema>;
export type BashToolInput = z.infer<typeof BashToolInputSchema>;
