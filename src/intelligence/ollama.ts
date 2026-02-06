import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config-loader.js';
import type { TaskResult } from '../types/task.js';
import type { CreateSummaryInput } from '../types/summary.js';

interface OllamaConfig {
  ai?: {
    providers?: {
      ollama?: {
        baseUrl?: string;
        summaryModel?: string;
        embeddingModel?: string;
      };
    };
  };
}

const config = loadConfig<OllamaConfig>('settings.yml');

/**
 * Ollama Service for local LLM inference
 */
export class OllamaService {
  private baseUrl: string;
  private summaryModel: string;
  private embeddingModel: string;

  constructor() {
    this.baseUrl = config.ai?.providers?.ollama?.baseUrl || 'http://localhost:11434';
    this.summaryModel = config.ai?.providers?.ollama?.summaryModel || 'llama3.2:3b';
    this.embeddingModel = config.ai?.providers?.ollama?.embeddingModel || 'mxbai-embed-large';
  }

  /**
   * Check if Ollama is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch (error) {
      logger.debug('[Ollama] Health check failed, service unavailable');
      return false;
    }
  }

  /**
   * Generate a structured summary from task output using Ollama
   */
  async generateSummary(taskResult: TaskResult, context: {
    taskId?: string;
    agent?: string;
    model?: string;
    startedAt?: Date;
  }): Promise<CreateSummaryInput | null> {
    const isAvailable = await this.healthCheck();
    if (!isAvailable) {
      logger.warn('[Ollama] Service not available, skipping local summary generation');
      return null;
    }

    const prompt = this.buildSummaryPrompt(taskResult);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.summaryModel,
          prompt,
          stream: false,
          options: {
            temperature: 0.3, // Lower temperature for more focused summaries
            num_predict: 1000,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json() as { response: string };
      const summaryText = data.response;

      // Parse the structured output
      return this.parseStructuredSummary(summaryText, taskResult, context);
    } catch (error) {
      logger.error('[Ollama] Summary generation failed:', error as Error);
      return null;
    }
  }

  /**
   * Generate an embedding using Ollama
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text.substring(0, 8000),
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embedding error: ${response.status}`);
      }

      const data = await response.json() as { embedding: number[] };
      return data.embedding;
    } catch (error) {
      logger.error('[Ollama] Embedding generation failed:', error as Error);
      throw error;
    }
  }

  /**
   * Build a prompt for summary generation
   */
  private buildSummaryPrompt(taskResult: TaskResult): string {
    return `You are an AI assistant that creates structured summaries of completed tasks.

TASK OUTPUT:
${taskResult.output || 'No output provided'}

${taskResult.error ? `ERROR:\n${taskResult.error.message}\n` : ''}

Please analyze this task result and provide a structured summary in the following format:

TITLE: [A concise title describing what was done]

WHAT_CHANGED:
[Describe the high-level changes made in 2-3 sentences]

WHY_CHANGED:
[Explain the motivation or reasoning behind these changes in 1-2 sentences]

HOW_CHANGED:
[Describe the technical approach or implementation strategy]

FILES_CHANGED:
[List any files that were created, modified, or deleted, one per line in format: action|path]

DECISIONS:
[List any key technical decisions made, one per line]

Generate the summary now:`;
  }

  /**
   * Parse the LLM output into a CreateSummaryInput
   */
  private parseStructuredSummary(
    summaryText: string,
    taskResult: TaskResult,
    context: {
      taskId?: string;
      agent?: string;
      model?: string;
      startedAt?: Date;
    }
  ): CreateSummaryInput {
    const sections = this.extractSections(summaryText);

    return {
      taskId: context.taskId,
      agent: context.agent || 'ollama',
      model: context.model || this.summaryModel,
      startedAt: context.startedAt,
      completedAt: new Date(),
      title: sections.title || 'AI Task Completed',
      whatChanged: sections.whatChanged || taskResult.output?.substring(0, 500) || 'Task completed',
      whyChanged: sections.whyChanged,
      howChanged: sections.howChanged,
      filesChanged: this.parseFilesChanged(sections.filesChanged),
      decisions: this.parseDecisions(sections.decisions),
      rawOutput: taskResult.output,
    };
  }

  /**
   * Extract sections from the LLM response
   */
  private extractSections(text: string): Record<string, string> {
    const sections: Record<string, string> = {};
    
    const titleMatch = text.match(/TITLE:\s*(.+)/i);
    if (titleMatch) sections.title = titleMatch[1].trim();

    const whatMatch = text.match(/WHAT_CHANGED:\s*([\s\S]+?)(?=WHY_CHANGED:|HOW_CHANGED:|FILES_CHANGED:|DECISIONS:|$)/i);
    if (whatMatch) sections.whatChanged = whatMatch[1].trim();

    const whyMatch = text.match(/WHY_CHANGED:\s*([\s\S]+?)(?=HOW_CHANGED:|FILES_CHANGED:|DECISIONS:|$)/i);
    if (whyMatch) sections.whyChanged = whyMatch[1].trim();

    const howMatch = text.match(/HOW_CHANGED:\s*([\s\S]+?)(?=FILES_CHANGED:|DECISIONS:|$)/i);
    if (howMatch) sections.howChanged = howMatch[1].trim();

    const filesMatch = text.match(/FILES_CHANGED:\s*([\s\S]+?)(?=DECISIONS:|$)/i);
    if (filesMatch) sections.filesChanged = filesMatch[1].trim();

    const decisionsMatch = text.match(/DECISIONS:\s*([\s\S]+?)$/i);
    if (decisionsMatch) sections.decisions = decisionsMatch[1].trim();

    return sections;
  }

  /**
   * Parse files changed from text
   */
  private parseFilesChanged(text?: string): Array<{ path: string; action: 'created' | 'modified' | 'deleted' | 'renamed' }> {
    if (!text) return [];

    const files: Array<{ path: string; action: 'created' | 'modified' | 'deleted' | 'renamed' }> = [];
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
      const match = line.match(/(created|modified|deleted|renamed)\|(.+)/i);
      if (match) {
        files.push({
          action: match[1].toLowerCase() as any,
          path: match[2].trim(),
        });
      }
    }

    return files;
  }

  /**
   * Parse decisions from text
   */
  private parseDecisions(text?: string): Array<{ description: string }> {
    if (!text) return [];

    const decisions: Array<{ description: string }> = [];
    const lines = text.split('\n').filter(l => l.trim() && l.trim() !== '-');

    for (const line of lines) {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      if (cleaned) {
        decisions.push({ description: cleaned });
      }
    }

    return decisions;
  }
}

// Singleton instance
let instance: OllamaService | null = null;

export function getOllamaService(): OllamaService {
  if (!instance) {
    instance = new OllamaService();
  }
  return instance;
}
