/**
 * Chat CLI Command
 *
 * Provides interactive and single-shot chat with profClaw AI.
 * Following OpenClaw patterns for CLI agent invocation.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { error, success, spinner, info } from '../utils/output.js';

// === Types ===

interface ChatResponse {
  id?: string;
  content?: string;
  model?: string;
  provider?: string;
  message?: {
    role: string;
    content: string;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  };
  error?: string;
}

interface ConversationResponse {
  conversation: {
    id: string;
    title?: string;
    mode: 'chat' | 'agentic';
    presetId: string;
    createdAt: string;
  };
}

interface MessageResponse {
  userMessage: {
    id: string;
    content: string;
    createdAt: string;
  };
  assistantMessage: {
    id: string;
    content: string;
    model?: string;
    provider?: string;
    toolCalls?: Array<{
      name: string;
      arguments: unknown;
      result?: unknown;
      status: string;
    }>;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  };
  toolCalls?: Array<{
    name: string;
    arguments: unknown;
    result?: unknown;
  }>;
}

interface ChatOptions {
  model?: string;
  json?: boolean;
  tools?: boolean;
  agentic?: boolean;
  session?: string;
  stream?: boolean;
}

// === Helpers ===

/**
 * Format tool call for display
 */
function formatToolCall(tc: { name: string; arguments: unknown; result?: unknown }): string {
  const args = typeof tc.arguments === 'object'
    ? JSON.stringify(tc.arguments, null, 2)
    : String(tc.arguments);

  let output = chalk.dim(`  ⚙ ${chalk.cyan(tc.name)}(${args})`);

  if (tc.result !== undefined) {
    const resultStr = typeof tc.result === 'object'
      ? JSON.stringify(tc.result, null, 2).split('\n').map(l => '    ' + l).join('\n')
      : String(tc.result);
    output += '\n' + chalk.dim(`    → ${resultStr.slice(0, 200)}${resultStr.length > 200 ? '...' : ''}`);
  }

  return output;
}

/**
 * Format usage statistics
 */
function formatUsage(usage: { promptTokens: number; completionTokens: number; totalTokens: number; cost?: number }): string {
  let output = chalk.dim(`  📊 ${usage.promptTokens} in / ${usage.completionTokens} out (${usage.totalTokens} total)`);
  if (usage.cost !== undefined && usage.cost > 0) {
    output += chalk.dim(` ≈ $${usage.cost.toFixed(4)}`);
  }
  return output;
}

/**
 * Execute single-shot chat
 */
async function executeSingleShot(message: string, options: ChatOptions): Promise<void> {
  const spin = spinner('Thinking...').start();

  try {
    // Use quick endpoint for simple single messages
    const result = await api.post<ChatResponse>('/api/chat/quick', {
      prompt: message,
      model: options.model,
    });

    spin.stop();

    if (!result.ok || result.data?.error) {
      error(result.error || result.data?.error || 'Chat failed');
      process.exit(1);
    }

    const data = result.data!;

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    // Print response
    console.log('');
    console.log(chalk.cyan('profClaw') + chalk.dim(` (${data.model || 'unknown'})`) + ':');
    console.log(data.content || data.message?.content || '(no response)');

    if (data.usage) {
      console.log('');
      console.log(formatUsage(data.usage));
    }
  } catch (err) {
    spin.stop();
    error(err instanceof Error ? err.message : 'Chat failed');
    process.exit(1);
  }
}

/**
 * Execute single-shot chat with tools
 */
async function executeSingleShotWithTools(message: string, options: ChatOptions): Promise<void> {
  const spin = spinner('Thinking...').start();

  try {
    const result = await api.post<ChatResponse & { toolCalls?: Array<{ name: string; arguments: unknown; result?: unknown }> }>(
      '/api/chat/with-tools',
      {
        messages: [{ role: 'user', content: message }],
        model: options.model,
        presetId: options.agentic ? 'agentic' : 'profclaw-assistant',
        enableAllTools: options.agentic,
        securityMode: options.agentic ? 'full' : 'ask',
      }
    );

    spin.stop();

    if (!result.ok || result.data?.error) {
      error(result.error || result.data?.error || 'Chat failed');
      process.exit(1);
    }

    const data = result.data!;

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    // Print tool calls if any
    if (data.toolCalls && data.toolCalls.length > 0) {
      console.log('');
      console.log(chalk.yellow('Tool Calls:'));
      for (const tc of data.toolCalls) {
        console.log(formatToolCall(tc));
      }
    }

    // Print response
    console.log('');
    console.log(chalk.cyan('profClaw') + chalk.dim(` (${data.model || 'unknown'})`) + ':');
    console.log(data.content || data.message?.content || '(no response)');

    if (data.usage) {
      console.log('');
      console.log(formatUsage(data.usage));
    }
  } catch (err) {
    spin.stop();
    error(err instanceof Error ? err.message : 'Chat failed');
    process.exit(1);
  }
}

/**
 * Start interactive REPL mode
 * Uses the self-contained interactive module (extractable as standalone package)
 */
async function startREPL(options: ChatOptions): Promise<void> {
  const { startInteractiveREPL } = await import('../interactive/index.js');
  const { getConfig } = await import('../utils/config.js');

  const config = getConfig();

  await startInteractiveREPL({
    server: {
      baseUrl: config.apiUrl || 'http://localhost:3000',
      apiToken: config.apiToken,
    },
    model: options.model,
    sessionId: options.session,
    agentic: options.agentic,
    effort: 'medium',
  });
}

// === CLI Commands ===

export function chatCommands() {
  const chat = new Command('chat')
    .description('AI chat with profClaw intelligence')
    .argument('[message]', 'Message to send (single-shot mode)')
    .option('-m, --model <model>', 'AI model to use (e.g., sonnet, opus, gpt-4)')
    .option('-t, --tools', 'Enable tool calling')
    .option('-a, --agentic', 'Enable agentic mode with all tools')
    .option('-s, --session <id>', 'Resume existing session')
    .option('--json', 'Output as JSON (single-shot only)')
    .action(async (message: string | undefined, options: ChatOptions) => {
      if (message) {
        // Single-shot mode
        if (options.tools || options.agentic) {
          await executeSingleShotWithTools(message, options);
        } else {
          await executeSingleShot(message, options);
        }
      } else {
        // Interactive REPL mode
        await startREPL(options);
      }
    });

  // Quick sub-commands
  chat
    .command('quick <message>')
    .description('Quick single-shot chat (no conversation)')
    .option('-m, --model <model>', 'AI model to use')
    .option('--json', 'Output as JSON')
    .action(async (message: string, options: ChatOptions) => {
      await executeSingleShot(message, options);
    });

  chat
    .command('agent <message>')
    .alias('run')
    .description('Run message in agentic mode with all tools')
    .option('-m, --model <model>', 'AI model to use')
    .option('--json', 'Output as JSON')
    .action(async (message: string, options: ChatOptions) => {
      await executeSingleShotWithTools(message, { ...options, agentic: true });
    });

  chat
    .command('sessions')
    .alias('ls')
    .description('List recent chat sessions')
    .option('-l, --limit <n>', 'Number of sessions to show', '10')
    .option('--json', 'Output as JSON')
    .action(async (options: { limit: string; json?: boolean }) => {
      const spin = spinner('Fetching sessions...').start();

      const result = await api.get<{ conversations: Array<{ id: string; title?: string; mode: string; createdAt: string; preview?: string }> }>(
        `/api/chat/conversations/recent?limit=${options.limit}`
      );

      spin.stop();

      if (!result.ok) {
        error(result.error || 'Failed to fetch sessions');
        process.exit(1);
      }

      const { conversations } = result.data!;

      if (options.json) {
        console.log(JSON.stringify(conversations, null, 2));
        return;
      }

      if (conversations.length === 0) {
        console.log('No sessions found.');
        return;
      }

      console.log('');
      console.log(chalk.bold('Recent Sessions:'));
      console.log('');

      for (const conv of conversations) {
        const modeIcon = conv.mode === 'agentic' ? '🤖' : '💬';
        const created = new Date(conv.createdAt).toLocaleDateString();
        console.log(`  ${modeIcon} ${chalk.cyan(conv.id.slice(0, 8))}  ${conv.title || chalk.dim('(untitled)')}  ${chalk.dim(created)}`);
        if (conv.preview) {
          console.log(chalk.dim(`     "${conv.preview.slice(0, 60)}${conv.preview.length > 60 ? '...' : ''}"`));
        }
      }

      console.log('');
      console.log(chalk.dim(`Resume with: profclaw chat -s <session-id>`));
    });

  return chat;
}
