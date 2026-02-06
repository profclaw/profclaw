/**
 * External Agent Webhook Handlers
 *
 * Receives completion notifications from external AI agents like OpenClaw, Devin, etc.
 * These webhooks allow agents to report their work back to GLINR.
 */

import { randomUUID } from 'crypto';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Context } from 'hono';
import { z } from 'zod';

// ============================================================================
// Schemas
// ============================================================================

/**
 * Generic agent completion payload
 */
export const AgentCompletionSchema = z.object({
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  agent: z.string(), // Agent identifier (e.g., 'openclaw', 'devin', 'custom')
  status: z.enum(['completed', 'failed', 'partial', 'cancelled']),
  summary: z.string(),
  output: z.string().optional(),
  artifacts: z.array(z.object({
    type: z.enum(['commit', 'pull_request', 'file', 'comment', 'branch', 'other']),
    url: z.string().optional(),
    sha: z.string().optional(),
    path: z.string().optional(),
    content: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })).optional(),
  tokensUsed: z.object({
    input: z.number(),
    output: z.number(),
    model: z.string().optional(),
  }).optional(),
  duration: z.number().optional(), // milliseconds
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type AgentCompletion = z.infer<typeof AgentCompletionSchema>;

/**
 * OpenClaw-specific payload (extends generic)
 */
export const OpenClawCompletionSchema = AgentCompletionSchema.extend({
  agent: z.literal('openclaw'),
  workingDir: z.string().optional(),
  repository: z.string().optional(),
  branch: z.string().optional(),
});

export type OpenClawCompletion = z.infer<typeof OpenClawCompletionSchema>;

// ============================================================================
// Storage
// ============================================================================

interface AgentReport {
  id: string;
  receivedAt: Date;
  agent: string;
  taskId?: string;
  status: string;
  summary: string;
  artifacts: AgentCompletion['artifacts'];
  tokensUsed?: AgentCompletion['tokensUsed'];
  duration?: number;
}

const agentReports = new Map<string, AgentReport>();
const taskReports = new Map<string, AgentReport[]>(); // taskId -> reports

// ============================================================================
// Signature Verification
// ============================================================================

const WEBHOOK_SECRETS: Record<string, string | undefined> = {
  openclaw: process.env.OPENCLAW_WEBHOOK_SECRET,
  devin: process.env.DEVIN_WEBHOOK_SECRET,
  generic: process.env.AGENT_WEBHOOK_SECRET,
};

/**
 * Verify HMAC signature for webhook payload
 */
function verifySignature(
  agent: string,
  rawBody: string,
  signature: string | undefined
): boolean {
  const secret = WEBHOOK_SECRETS[agent] || WEBHOOK_SECRETS.generic;

  // Skip verification if no secret configured
  if (!secret) {
    console.warn(`[Webhook] No secret configured for ${agent}, skipping verification`);
    return true;
  }

  if (!signature) {
    return false;
  }

  // Support both raw and prefixed signatures (e.g., "sha256=...")
  const expectedSig = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature;

  const computedSig = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(computedSig, 'hex')
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * Handle OpenClaw completion webhook
 */
export async function handleOpenClawWebhook(c: Context): Promise<AgentReport | null> {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-OpenClaw-Signature') || c.req.header('X-Signature');

  // Verify signature
  if (!verifySignature('openclaw', rawBody, signature)) {
    throw new Error('Invalid webhook signature');
  }

  // Parse payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON payload');
  }

  const parsed = OpenClawCompletionSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('[Webhook] OpenClaw validation failed:', parsed.error.flatten());
    throw new Error(`Validation failed: ${parsed.error.message}`);
  }

  return processAgentCompletion(parsed.data);
}

/**
 * Handle generic agent webhook (works for any agent)
 */
export async function handleGenericAgentWebhook(c: Context): Promise<AgentReport | null> {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Webhook-Signature') || c.req.header('X-Signature');
  const agentHeader = c.req.header('X-Agent-Type') || 'unknown';

  // Verify signature
  if (!verifySignature(agentHeader, rawBody, signature)) {
    throw new Error('Invalid webhook signature');
  }

  // Parse payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON payload');
  }

  const parsed = AgentCompletionSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('[Webhook] Agent validation failed:', parsed.error.flatten());
    throw new Error(`Validation failed: ${parsed.error.message}`);
  }

  return processAgentCompletion(parsed.data);
}

/**
 * Process and store agent completion
 */
function processAgentCompletion(completion: AgentCompletion): AgentReport {
  const report: AgentReport = {
    id: randomUUID(),
    receivedAt: new Date(),
    agent: completion.agent,
    taskId: completion.taskId,
    status: completion.status,
    summary: completion.summary,
    artifacts: completion.artifacts,
    tokensUsed: completion.tokensUsed,
    duration: completion.duration,
  };

  // Store report
  agentReports.set(report.id, report);

  // Index by task if available
  if (report.taskId) {
    const reports = taskReports.get(report.taskId) || [];
    reports.push(report);
    taskReports.set(report.taskId, reports);
  }

  // Log
  console.log(`[Webhook] Agent ${completion.agent} reported: ${completion.status}`);
  if (completion.artifacts?.length) {
    console.log(`[Webhook] Artifacts: ${completion.artifacts.length} items`);
  }

  return report;
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get report by ID
 */
export function getAgentReport(reportId: string): AgentReport | undefined {
  return agentReports.get(reportId);
}

/**
 * Get all reports for a task
 */
export function getTaskReports(taskId: string): AgentReport[] {
  return taskReports.get(taskId) || [];
}

/**
 * Get recent reports
 */
export function getRecentReports(limit = 50): AgentReport[] {
  return [...agentReports.values()]
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
    .slice(0, limit);
}

/**
 * Get reports by agent type
 */
export function getReportsByAgent(agent: string, limit = 50): AgentReport[] {
  return [...agentReports.values()]
    .filter(r => r.agent === agent)
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
    .slice(0, limit);
}
