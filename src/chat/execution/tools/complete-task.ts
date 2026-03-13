/**
 * Complete Task Tool
 *
 * Allows the AI agent to signal that a task has been completed.
 * This is the primary mechanism for the agentic loop to know when to stop.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const ArtifactSchema = z.object({
  type: z.enum(['ticket', 'commit', 'file', 'pr', 'project', 'comment', 'other']).describe('Type of artifact'),
  id: z.string().describe('Identifier for the artifact'),
  description: z.string().optional().describe('Brief description of the artifact'),
  url: z.string().optional().describe('URL to the artifact if applicable'),
});

const CompleteTaskParamsSchema = z.object({
  summary: z.string().min(1).describe('Summary of what was accomplished'),
  artifacts: z.array(ArtifactSchema).optional().describe('Artifacts created during the task'),
  nextSteps: z.array(z.string()).optional().describe('Suggested follow-up actions for the user'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .default('high')
    .describe('Confidence level that the task was fully completed'),
});

export type CompleteTaskParams = z.infer<typeof CompleteTaskParamsSchema>;

// Result Type

interface CompleteTaskResult {
  /** Signals the agentic loop that the task is complete */
  complete: true;
  /** Summary of what was accomplished */
  summary: string;
  /** Artifacts created during execution */
  artifacts: Array<{
    type: string;
    id: string;
    description?: string;
    url?: string;
  }>;
  /** Suggested next steps */
  nextSteps: string[];
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
  /** Timestamp of completion */
  completedAt: string;
}

// Tool Definition

export const completeTaskTool: ToolDefinition<CompleteTaskParams, CompleteTaskResult> = {
  name: 'complete_task',
  description: `Signal that the current task has been FULLY completed.

**WHEN TO CALL THIS TOOL:**
- You have completed ALL requested actions
- The user's goal has been achieved
- You have a clear summary of what was done

**WHEN NOT TO CALL THIS TOOL:**
- You are still in the middle of completing steps
- You need to call more tools to finish the task
- The task failed and you need to retry

**EXAMPLE WORKFLOW:**
1. User: "Create a bug ticket for login issue"
2. You: Call list_projects → get project key "PC"
3. You: Call create_ticket → ticket "PC-42" created
4. You: Call complete_task → summary: "Created bug ticket PC-42 for login issue"

**IMPORTANT:** Always include:
- A clear summary of what was done
- Any artifacts that were created (tickets, files, etc.)
- Suggested next steps if applicable`,

  category: 'profclaw',
  securityLevel: 'safe',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: CompleteTaskParamsSchema,
  examples: [
    {
      description: 'Complete after creating a ticket',
      params: {
        summary: 'Created bug ticket PC-42 for the login button issue',
        artifacts: [
          {
            type: 'ticket',
            id: 'PC-42',
            description: 'Fix login button not responding',
          },
        ],
        nextSteps: ['Assign the ticket to a developer', 'Add more details to the description'],
        confidence: 'high',
      },
    },
    {
      description: 'Complete after a search task',
      params: {
        summary: 'Found 3 open bugs related to authentication in the profClaw project',
        artifacts: [
          { type: 'ticket', id: 'PC-10', description: 'Session timeout bug' },
          { type: 'ticket', id: 'PC-15', description: 'OAuth redirect issue' },
          { type: 'ticket', id: 'PC-22', description: 'Password reset not working' },
        ],
        confidence: 'high',
      },
    },
  ],

  async execute(
    _context: ToolExecutionContext,
    params: CompleteTaskParams
  ): Promise<ToolResult<CompleteTaskResult>> {
    logger.info('[Agent] Task marked as complete:', {
      summary: params.summary,
      artifactCount: params.artifacts?.length ?? 0,
      confidence: params.confidence ?? 'high',
    });

    return {
      success: true,
      data: {
        complete: true,
        summary: params.summary,
        artifacts: params.artifacts ?? [],
        nextSteps: params.nextSteps ?? [],
        confidence: params.confidence ?? 'high',
        completedAt: new Date().toISOString(),
      },
    };
  },
};

// Export

export default completeTaskTool;
