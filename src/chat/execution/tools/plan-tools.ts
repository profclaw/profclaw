/**
 * Plan Mode Tools
 *
 * Two tools the agent can call to create a plan and mark steps as completed.
 * Plans go through a draft → approved/rejected → in_progress → completed lifecycle.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { planManager } from '../../../agents/plan-mode.js';
import type { PlanStep } from '../../../agents/plan-mode.js';
import { logger } from '../../../utils/logger.js';

// ─── create_plan ────────────────────────────────────────────────────────────

const CreatePlanParamsSchema = z.object({
  title: z.string().min(1).describe('Short title for the plan'),
  steps: z
    .array(
      z.object({
        description: z.string().min(1).describe('What this step does'),
        files: z.array(z.string()).optional().describe('Files this step will touch'),
        estimatedEffort: z
          .enum(['small', 'medium', 'large'])
          .optional()
          .describe('Rough effort estimate'),
      })
    )
    .min(1)
    .describe('Ordered list of implementation steps'),
});

export type CreatePlanParams = z.infer<typeof CreatePlanParamsSchema>;

interface CreatePlanResult {
  planId: string;
  status: 'awaiting_approval';
  message: string;
  stepCount: number;
}

export const createPlanTool: ToolDefinition<CreatePlanParams, CreatePlanResult> = {
  name: 'create_plan',
  description: `Create an implementation plan before making changes.

Use this for any multi-step task. Write out every discrete step you intend to
take. The user will review the plan and approve or reject it before you begin
any implementation.

**When to call this:**
- Task requires changes to 2 or more files
- Task has distinct phases (e.g., data model → API → tests)
- User asks you to plan before coding

**After calling this tool, STOP and wait.** Do not proceed until the user runs
\`profclaw plan approve <id>\` or tells you the plan is approved.`,

  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: CreatePlanParamsSchema,

  examples: [
    {
      description: 'Plan a feature implementation',
      params: {
        title: 'Add rate limiting to API endpoints',
        steps: [
          { description: 'Add rate-limit middleware in src/middleware/rate-limit.ts', estimatedEffort: 'medium', files: ['src/middleware/rate-limit.ts'] },
          { description: 'Apply middleware to all /api/* routes in src/routes/index.ts', estimatedEffort: 'small', files: ['src/routes/index.ts'] },
          { description: 'Write unit tests for rate-limit middleware', estimatedEffort: 'medium', files: ['src/middleware/rate-limit.test.ts'] },
        ],
      },
    },
  ],

  async execute(
    _context: ToolExecutionContext,
    params: CreatePlanParams
  ): Promise<ToolResult<CreatePlanResult>> {
    logger.info('[PlanTool] Creating plan:', { title: params.title, stepCount: params.steps.length });

    const stepsWithIndex: Omit<PlanStep, 'status'>[] = params.steps.map((s, i) => ({
      index: i + 1,
      description: s.description,
      files: s.files,
      estimatedEffort: s.estimatedEffort,
    }));

    const plan = planManager.create(params.title, stepsWithIndex);

    return {
      success: true,
      data: {
        planId: plan.id,
        status: 'awaiting_approval',
        message: `Plan created with ${plan.steps.length} step(s). Waiting for user approval. Run: profclaw plan approve ${plan.id}`,
        stepCount: plan.steps.length,
      },
    };
  },
};

// ─── complete_plan_step ─────────────────────────────────────────────────────

const CompletePlanStepParamsSchema = z.object({
  stepIndex: z.number().int().min(1).describe('The 1-based index of the completed step'),
  summary: z.string().optional().describe('Optional summary of what was done in this step'),
});

export type CompletePlanStepParams = z.infer<typeof CompletePlanStepParamsSchema>;

interface CompletePlanStepResult {
  status: 'step_completed' | 'plan_completed';
  completedStep: number;
  nextStep?: { index: number; description: string };
  planId: string;
}

export const completePlanStepTool: ToolDefinition<CompletePlanStepParams, CompletePlanStepResult> = {
  name: 'complete_plan_step',
  description: `Mark a plan step as completed after implementing it.

Call this after finishing each step in an approved plan. The tool will tell you
what the next pending step is so you can proceed in order.

**When to call this:**
- You have fully implemented the current step
- All files for the step are written/edited and working

**Do not call this:**
- Before the step is actually done
- If there is no active plan`,

  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: CompletePlanStepParamsSchema,

  async execute(
    _context: ToolExecutionContext,
    params: CompletePlanStepParams
  ): Promise<ToolResult<CompletePlanStepResult>> {
    const plan = planManager.getActive();

    if (!plan) {
      return {
        success: false,
        error: {
          code: 'NO_ACTIVE_PLAN',
          message: 'No active (in_progress) plan found. Approve a plan first.',
        },
      };
    }

    logger.info('[PlanTool] Completing step:', {
      planId: plan.id,
      stepIndex: params.stepIndex,
      summary: params.summary,
    });

    const updated = planManager.updateStep(plan.id, params.stepIndex, 'completed');
    const nextStep = updated.steps.find((s) => s.status === 'pending');
    const planDone = updated.status === 'completed';

    return {
      success: true,
      data: {
        status: planDone ? 'plan_completed' : 'step_completed',
        completedStep: params.stepIndex,
        nextStep: nextStep
          ? { index: nextStep.index, description: nextStep.description }
          : undefined,
        planId: plan.id,
      },
    };
  },
};

// ─── Exports ─────────────────────────────────────────────────────────────────

export const planTools = [createPlanTool, completePlanStepTool] as const;
