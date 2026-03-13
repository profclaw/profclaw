/**
 * Subagent Orchestrate Tool
 *
 * Orchestrate multiple subtasks across parallel or sequential agent sessions.
 * Delegates work by spawning sessions and sending messages to each.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const SubtaskSchema = z.object({
  description: z.string().min(1).describe('What this subtask should accomplish'),
  agent_type: z.string().optional().describe('Optional agent preset ID for this subtask'),
  metadata: z.record(z.string()).optional().describe('Extra metadata for this subtask'),
});

const SubagentOrchestrateParamsSchema = z.object({
  task: z.string().min(1).describe('The high-level task to orchestrate'),
  subtasks: z
    .array(SubtaskSchema)
    .min(1)
    .max(10)
    .describe('List of subtasks to delegate (1-10 subtasks)'),
  strategy: z
    .enum(['parallel', 'sequential', 'pipeline'])
    .default('parallel')
    .describe(
      'Execution strategy: parallel (all at once), sequential (one after another), pipeline (each feeds into the next)',
    ),
  max_concurrent: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(3)
    .describe('Max concurrent subtasks for parallel strategy (default: 3)'),
});

export type SubagentOrchestrateParams = z.infer<typeof SubagentOrchestrateParamsSchema>;

// Types

export interface SubtaskResult {
  index: number;
  description: string;
  sessionId: string;
  status: 'completed' | 'failed' | 'skipped';
  output?: string;
  error?: string;
  durationMs: number;
}

export interface SubagentOrchestrateResult {
  task: string;
  strategy: string;
  total: number;
  completed: number;
  failed: number;
  results: SubtaskResult[];
  totalDurationMs: number;
}

// Helpers

interface SpawnResult {
  sessionId: string;
  title: string;
}

async function spawnSession(description: string, agentType?: string): Promise<SpawnResult> {
  const { createConversation, addMessage } = await import('../../conversations.js');

  const title = description.slice(0, 60) + (description.length > 60 ? '...' : '');

  const conversation = await createConversation({
    title,
    presetId: agentType ?? 'profclaw-assistant',
  });

  await addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: description,
  });

  return {
    sessionId: conversation.id,
    title,
  };
}

async function executeSubtaskInSession(
  sessionId: string,
  _description: string,
): Promise<{ response: string; error?: undefined } | { response?: undefined; error: string }> {
  try {
    const { getConversation, getConversationMessages, addMessage } = await import('../../conversations.js');
    const { aiProvider } = await import('../../../providers/index.js');
    const { buildSystemPrompt } = await import('../../system-prompts.js');

    const conversation = await getConversation(sessionId);
    if (!conversation) {
      return { error: `Session ${sessionId} not found` };
    }

    const messages = await getConversationMessages(sessionId);

    type MsgRecord = { id: string; role: string; content: string; createdAt: string };
    const chatMessages = messages.map((m: MsgRecord) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      timestamp: m.createdAt,
    }));

    const defaultProvider = aiProvider.getDefaultProvider();
    const resolvedRef = aiProvider.resolveModel(defaultProvider);
    const resolvedModel = `${resolvedRef.provider}/${resolvedRef.model}`;

    const systemPrompt = await buildSystemPrompt(conversation.presetId, {
      runtime: {
        model: resolvedModel,
        provider: resolvedRef.provider,
        defaultModel: resolvedModel,
        conversationId: sessionId,
      },
    });

    const response = await aiProvider.chat({
      messages: chatMessages,
      model: resolvedModel,
      systemPrompt,
      temperature: 0.3,
    });

    await addMessage({
      conversationId: sessionId,
      role: 'assistant',
      content: response.content,
      model: response.model,
      provider: response.provider,
    });

    return { response: response.content };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function runSubtask(
  subtask: SubagentOrchestrateParams['subtasks'][number],
  index: number,
  previousOutput?: string,
): Promise<SubtaskResult> {
  const start = Date.now();

  // For pipeline strategy, prepend previous output to task description
  const effectiveDescription = previousOutput
    ? `Previous step output:\n${previousOutput.slice(0, 1000)}\n\nYour task: ${subtask.description}`
    : subtask.description;

  let sessionId = '';

  try {
    const spawned = await spawnSession(effectiveDescription, subtask.agent_type);
    sessionId = spawned.sessionId;

    const execResult = await executeSubtaskInSession(sessionId, effectiveDescription);

    if (execResult.error) {
      return {
        index,
        description: subtask.description,
        sessionId,
        status: 'failed',
        error: execResult.error,
        durationMs: Date.now() - start,
      };
    }

    return {
      index,
      description: subtask.description,
      sessionId,
      status: 'completed',
      output: execResult.response,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      index,
      description: subtask.description,
      sessionId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: Date.now() - start,
    };
  }
}

// Tool Definition

export const subagentOrchestrateTool: ToolDefinition<SubagentOrchestrateParams, SubagentOrchestrateResult> = {
  name: 'subagent_orchestrate',
  description: `Orchestrate multiple subtasks across parallel or sequential agent sessions.

Strategies:
- **parallel**: Run all subtasks concurrently (fastest, up to max_concurrent at once)
- **sequential**: Run subtasks one after another in order
- **pipeline**: Each subtask receives the output of the previous one as context

Use this to:
- Break large tasks into parallel workstreams
- Coordinate research + implementation + review phases
- Build multi-step pipelines where each step builds on the last

Returns results for each subtask including status, output, and session ID.
Requires approval before execution.`,
  category: 'execution',
  securityLevel: 'moderate',
  requiresApproval: true,
  parameters: SubagentOrchestrateParamsSchema,

  isAvailable() {
    return { available: true };
  },

  examples: [
    {
      description: 'Parallel research across multiple topics',
      params: {
        task: 'Research competitors and market landscape',
        strategy: 'parallel',
        subtasks: [
          { description: 'Research OpenAI agent capabilities and pricing' },
          { description: 'Research Anthropic Claude API features' },
          { description: 'Research open-source agent frameworks (AutoGen, CrewAI)' },
        ],
      },
    },
    {
      description: 'Sequential code review pipeline',
      params: {
        task: 'Review and improve the authentication module',
        strategy: 'sequential',
        subtasks: [
          { description: 'Analyze the current auth.ts file for security issues' },
          { description: 'Review test coverage for auth module' },
          { description: 'Write a summary of findings and recommendations' },
        ],
      },
    },
    {
      description: 'Pipeline: research then implement',
      params: {
        task: 'Implement a rate limiter',
        strategy: 'pipeline',
        subtasks: [
          { description: 'Research best practices for rate limiting in Node.js APIs' },
          { description: 'Design the rate limiter interface based on the research' },
          { description: 'Write the implementation plan with code structure' },
        ],
      },
    },
  ],

  async execute(context: ToolExecutionContext, params: SubagentOrchestrateParams): Promise<ToolResult<SubagentOrchestrateResult>> {
    const startTime = Date.now();
    const results: SubtaskResult[] = [];

    logger.info(
      `[SubagentOrchestrate] Starting orchestration: "${params.task}" (${params.subtasks.length} subtasks, ${params.strategy})`,
      { component: 'SubagentOrchestrate' },
    );

    try {
      if (params.strategy === 'parallel') {
        const maxConcurrent = params.max_concurrent ?? 3;
        const chunks: Array<typeof params.subtasks> = [];

        for (let i = 0; i < params.subtasks.length; i += maxConcurrent) {
          chunks.push(params.subtasks.slice(i, i + maxConcurrent));
        }

        let chunkOffset = 0;
        for (const chunk of chunks) {
          const chunkResults = await Promise.all(
            chunk.map((subtask, idx) => runSubtask(subtask, chunkOffset + idx)),
          );
          results.push(...chunkResults);
          chunkOffset += chunk.length;
        }
      } else if (params.strategy === 'sequential') {
        for (let i = 0; i < params.subtasks.length; i++) {
          const result = await runSubtask(params.subtasks[i], i);
          results.push(result);

          if (result.status === 'failed') {
            // Mark remaining as skipped
            for (let j = i + 1; j < params.subtasks.length; j++) {
              results.push({
                index: j,
                description: params.subtasks[j].description,
                sessionId: '',
                status: 'skipped',
                error: 'Previous subtask failed',
                durationMs: 0,
              });
            }
            break;
          }
        }
      } else {
        // pipeline: each receives previous output
        let previousOutput: string | undefined;
        for (let i = 0; i < params.subtasks.length; i++) {
          const result = await runSubtask(params.subtasks[i], i, previousOutput);
          results.push(result);
          previousOutput = result.output;

          if (result.status === 'failed') {
            for (let j = i + 1; j < params.subtasks.length; j++) {
              results.push({
                index: j,
                description: params.subtasks[j].description,
                sessionId: '',
                status: 'skipped',
                error: 'Pipeline broken by previous failure',
                durationMs: 0,
              });
            }
            break;
          }
        }
      }

      const completed = results.filter((r) => r.status === 'completed').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      const totalDurationMs = Date.now() - startTime;

      logger.info(
        `[SubagentOrchestrate] Done: ${completed}/${params.subtasks.length} completed in ${totalDurationMs}ms`,
        { component: 'SubagentOrchestrate' },
      );

      const orchestrateResult: SubagentOrchestrateResult = {
        task: params.task,
        strategy: params.strategy,
        total: params.subtasks.length,
        completed,
        failed,
        results,
        totalDurationMs,
      };

      // Build output
      const lines = [
        `## Orchestration Complete: ${params.task}\n`,
        `**Strategy**: ${params.strategy} | **Duration**: ${(totalDurationMs / 1000).toFixed(1)}s`,
        `**Results**: ${completed}/${params.subtasks.length} completed${failed > 0 ? `, ${failed} failed` : ''}`,
        '',
        '### Subtask Results',
      ];

      for (const r of results) {
        const icon = r.status === 'completed' ? '[OK]' : r.status === 'failed' ? '[FAIL]' : '[SKIP]';
        lines.push(`\n${icon} **${r.index + 1}. ${r.description}**`);
        lines.push(`   Session: \`${r.sessionId.slice(0, 8) || 'n/a'}...\` | Duration: ${(r.durationMs / 1000).toFixed(1)}s`);
        if (r.output) {
          const preview = r.output.slice(0, 200);
          lines.push(`   Output: ${preview}${r.output.length > 200 ? '...' : ''}`);
        }
        if (r.error) {
          lines.push(`   Error: ${r.error}`);
        }
      }

      return {
        success: failed < params.subtasks.length, // success if at least one completed
        data: orchestrateResult,
        output: lines.join('\n'),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[SubagentOrchestrate] Fatal error: ${message}`, { component: 'SubagentOrchestrate' });

      return {
        success: false,
        error: {
          code: 'ORCHESTRATE_FAILED',
          message: `Orchestration failed: ${message}`,
        },
      };
    }
  },
};
