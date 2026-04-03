/**
 * Decompose Task Tool
 *
 * Splits a large task into smaller, independently-executable subtasks and
 * persists the plan to .profclaw/plans/ so it can be resumed across multiple
 * profClaw sessions.
 */

import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// ─── Schema ───────────────────────────────────────────────────────────────────

const SubtaskSchema = z.object({
  description: z
    .string()
    .min(1)
    .describe('Clear description of what this subtask accomplishes'),
  estimatedSteps: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe('Rough number of agentic steps expected'),
  files: z
    .array(z.string())
    .optional()
    .describe('Source files this subtask will read or modify'),
  dependencies: z
    .array(z.number())
    .optional()
    .describe('0-based indices of subtasks that must complete before this one'),
});

const DecomposeTaskParamsSchema = z.object({
  originalTask: z.string().min(1).describe('The full original task description'),
  subtasks: z
    .array(SubtaskSchema)
    .min(2)
    .describe('Ordered list of subtasks. Each should be small enough for one session.'),
  currentProgress: z
    .string()
    .optional()
    .describe('What has already been done in the current session, if anything'),
});

export type DecomposeTaskParams = z.infer<typeof DecomposeTaskParamsSchema>;

// ─── Result type ─────────────────────────────────────────────────────────────

interface DecomposeTaskResult {
  planId: string;
  planFile: string;
  subtaskCount: number;
  resumeCommand: string;
  summary: string;
}

// ─── Persisted plan shape ────────────────────────────────────────────────────

interface SubtaskPlanEntry {
  index: number;
  description: string;
  estimatedSteps: number;
  files?: string[];
  dependencies?: number[];
  status: 'pending' | 'in_progress' | 'completed';
}

interface PersistedPlan {
  planId: string;
  originalTask: string;
  currentProgress?: string;
  subtasks: SubtaskPlanEntry[];
  createdAt: number;
  updatedAt: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function savePlan(plan: PersistedPlan): Promise<string> {
  const plansDir = join(resolve(process.cwd()), '.profclaw', 'plans');
  if (!existsSync(plansDir)) {
    await mkdir(plansDir, { recursive: true });
  }
  const filePath = join(plansDir, `${plan.planId}.json`);
  await writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8');
  return filePath;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const decomposeTaskTool: ToolDefinition<DecomposeTaskParams, DecomposeTaskResult> = {
  name: 'decompose_task',
  description: `Split a complex task into smaller subtasks that can be executed in separate sessions.

**Use this tool when:**
- The remaining work exceeds the current token budget
- The task is too large to complete in a single agentic session
- The task has clearly separable phases (e.g. schema → API → tests → docs)
- You want to let the user track progress across multiple runs

**What happens:**
1. The plan is saved to .profclaw/plans/<planId>.json
2. A resume command is printed so the user can continue from where you left off
3. You should call complete_task immediately after to close this session cleanly

**Do NOT use this tool:**
- For small tasks that can finish in the current session
- As a way to avoid doing work`,

  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: DecomposeTaskParamsSchema,

  examples: [
    {
      description: 'Break a large refactor into phases',
      params: {
        originalTask: 'Refactor the auth module to use JWT and add rate limiting',
        subtasks: [
          {
            description: 'Replace session-based auth with JWT in src/auth/',
            estimatedSteps: 12,
            files: ['src/auth/session.ts', 'src/auth/jwt.ts', 'src/middleware/auth.ts'],
          },
          {
            description: 'Add rate-limit middleware and wire it to /api routes',
            estimatedSteps: 8,
            files: ['src/middleware/rate-limit.ts', 'src/routes/index.ts'],
            dependencies: [0],
          },
          {
            description: 'Write unit and integration tests for both changes',
            estimatedSteps: 10,
            files: ['src/auth/jwt.test.ts', 'src/middleware/rate-limit.test.ts'],
            dependencies: [0, 1],
          },
        ],
        currentProgress: 'Analysed the existing session auth code; no files changed yet.',
      },
    },
  ],

  async execute(
    _context: ToolExecutionContext,
    params: DecomposeTaskParams
  ): Promise<ToolResult<DecomposeTaskResult>> {
    const planId = randomUUID().replace(/-/g, '').slice(0, 12);
    const now = Date.now();

    const plan: PersistedPlan = {
      planId,
      originalTask: params.originalTask,
      currentProgress: params.currentProgress,
      subtasks: params.subtasks.map((st, i) => ({
        index: i,
        description: st.description,
        estimatedSteps: st.estimatedSteps,
        files: st.files,
        dependencies: st.dependencies,
        status: 'pending',
      })),
      createdAt: now,
      updatedAt: now,
    };

    let planFile: string;
    try {
      planFile = await savePlan(plan);
    } catch (err) {
      logger.error('[DecomposeTask] Failed to persist plan', { err });
      return {
        success: false,
        error: {
          code: 'PLAN_SAVE_FAILED',
          message: err instanceof Error ? err.message : 'Unknown error saving plan',
        },
      };
    }

    const resumeCommand = `profclaw chat --resume-plan ${planId}`;

    const subtaskList = plan.subtasks
      .map((st) => {
        const deps = st.dependencies?.length
          ? ` [after: ${st.dependencies.map((d) => `#${d}`).join(', ')}]`
          : '';
        return `  ${st.index + 1}. ${st.description} (~${st.estimatedSteps} steps)${deps}`;
      })
      .join('\n');

    const summary =
      `Task decomposed into ${plan.subtasks.length} subtasks.\n\n` +
      `${subtaskList}\n\n` +
      `Plan saved to: ${planFile}\n` +
      `Resume with: ${resumeCommand}`;

    logger.info('[DecomposeTask] Plan created', { planId, subtaskCount: plan.subtasks.length });

    return {
      success: true,
      data: {
        planId,
        planFile,
        subtaskCount: plan.subtasks.length,
        resumeCommand,
        summary,
      },
    };
  },
};

export default decomposeTaskTool;
