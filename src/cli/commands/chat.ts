/**
 * Chat CLI Command
 *
 * Provides interactive and single-shot chat with profClaw AI.
 * Following OpenClaw patterns for CLI agent invocation.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import type { ModelMessage } from 'ai';
import { api } from '../utils/api.js';
import { error, success, spinner, info } from '../utils/output.js';
import { getSessionDiffTracker } from '../../agents/session-diff.js';
import { getFileSnapshotManager } from '../../agents/file-snapshots.js';

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
  tui?: boolean;
  print?: boolean;
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
 * Launch the Ink-based TUI chat interface.
 * Wired to the actual profClaw streaming API via SSE.
 */
async function startTUI(options: ChatOptions): Promise<void> {
  const { render } = await import('ink');
  const React = (await import('react')).default;
  const { ChatApp } = await import('../ink/ChatApp.js');
  const { streamChat, createConversation: createConv } = await import('../interactive/stream-client.js');
  const { getConfig } = await import('../utils/config.js');
  const { detectBaseUrl } = await import('../utils/api.js');
  type AgentStatusState = 'idle' | 'thinking' | 'executing' | 'complete' | 'error';

  const config = getConfig();
  // Auto-detect the running profClaw server via shared utility
  const resolvedUrl = await detectBaseUrl();
  const serverConfig = {
    baseUrl: resolvedUrl,
    apiToken: config.apiToken,
  };

  // Fetch providers and models dynamically from the server
  type ModelEntry = { id: string; name: string; provider: string; costPer1MInput?: number; costPer1MOutput?: number };
  type ProviderEntry = { type: string; enabled: boolean; healthy: boolean; message?: string; latencyMs?: number };

  let availableProviders: Array<{ label: string; value: string; description: string; active: boolean; disabled?: boolean }> = [];
  let availableModels: Array<{ label: string; value: string; description: string; active: boolean; disabled?: boolean }> = [];
  let detectedModel = options.model ?? 'auto';
  let detectedProvider = 'auto';

  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (serverConfig.apiToken) headers['Authorization'] = `Bearer ${serverConfig.apiToken}`;

    const [provRes, modRes] = await Promise.allSettled([
      fetch(`${serverConfig.baseUrl}/api/chat/providers`, { headers }).then(r => r.ok ? r.json() : null) as Promise<{ default: string; providers: ProviderEntry[] } | null>,
      fetch(`${serverConfig.baseUrl}/api/chat/models`, { headers }).then(r => r.ok ? r.json() : null) as Promise<{ models: ModelEntry[] } | null>,
    ]);

    // Build providers list from API
    if (provRes.status === 'fulfilled' && provRes.value?.providers) {
      const provData = provRes.value;
      const healthy = provData.providers.filter(p => p.enabled && p.healthy);

      // Auto-detect best provider (prefer local first)
      if (!options.model) {
        const preferred = ['ollama', 'anthropic', 'openai', 'azure', 'google', 'cerebras'];
        const best = preferred.find(p => healthy.some(h => h.type === p)) ?? healthy[0]?.type ?? provData.default;
        detectedProvider = best ?? 'auto';

        const modelMap: Record<string, string> = {
          ollama: 'llama3.2',
          anthropic: 'claude-sonnet',
          openai: 'gpt-4o',
          azure: 'gpt-4o',
          google: 'gemini-2.0-flash',
          cerebras: 'llama-3.3-70b',
        };
        detectedModel = modelMap[detectedProvider] ?? 'auto';
      }

      // Show all providers: configured ones at top, unconfigured greyed out
      const configured = provData.providers.filter(p => p.enabled && p.healthy);
      const unconfigured = provData.providers.filter(p => !p.enabled || !p.healthy);
      availableProviders = [
        ...configured.map(p => ({
          label: p.type,
          value: p.type,
          description: `${p.message ?? 'configured'}${p.latencyMs ? ` · ${p.latencyMs}ms` : ''}`,
          active: p.type === detectedProvider,
        })),
        ...unconfigured.map(p => ({
          label: `${p.type} (not configured)`,
          value: p.type,
          description: p.healthy ? 'no API key' : (p.message ?? 'offline'),
          active: false,
          disabled: true,
        })),
      ];
    }

    // Build models list from API
    if (modRes.status === 'fulfilled' && modRes.value?.models) {
      // Only show models from configured (non-disabled) providers
      const configuredProviders = new Set(
        availableProviders.filter(p => !p.disabled).map(p => p.value)
      );
      const seen = new Set<string>();

      availableModels = modRes.value.models
        .filter(m => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return configuredProviders.size === 0 || configuredProviders.has(m.provider);
        })
        .map(m => {
          const costIn = m.costPer1MInput ?? 0;
          const costOut = m.costPer1MOutput ?? 0;
          const cost = costIn === 0 && costOut === 0 ? 'free' : `$${costIn}/$${costOut} per 1M`;
          return {
            label: m.name || m.id,
            value: m.id,
            description: `${m.provider} · ${cost}`,
            active: m.id === detectedModel,
          };
        });
    }
  } catch { /* fall back to empty lists */ }

  const sessionId = options.session ?? `tui-${Date.now().toString(36).slice(-4)}`;

  // Mutable TUI state — mutated in place, then rerender() flushes to Ink
  let currentModel = detectedModel;
  let currentProvider = detectedProvider;
  let agenticMode = options.agentic ?? false;
  let showThinking = false;
  let showTools = true;
  let effort: 'low' | 'medium' | 'high' = 'medium';

  let tokensUsed = 0;
  let estimatedCost = 0;
  const tokensMax = 100_000;
  let agentStatus: AgentStatusState = 'idle';
  let agentAction: string | undefined;
  let stepCount = 0;
  let elapsedMs = 0;
  let streamingContent: string | undefined;
  let conversationId: string | undefined;
  let lastUserMessage = '';
  let lastAssistantContent = '';
  let rerenderFn: (() => void) | null = null;
  let activeAbort: AbortController | null = null;

  const messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    model?: string;
    timestamp: Date;
  }> = [];

  function rerender() {
    rerenderFn?.();
  }

  function pushInfo(content: string) {
    messages.push({ role: 'assistant', content, timestamp: new Date() });
    rerender();
  }

  /** Fetch recent sessions from server */
  async function fetchSessions(limit = 15): Promise<Array<{ id: string; title?: string; mode: string; createdAt: string }>> {
    try {
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (serverConfig.apiToken) headers['Authorization'] = `Bearer ${serverConfig.apiToken}`;
      const res = await fetch(`${serverConfig.baseUrl}/api/chat/conversations/recent?limit=${limit}`, { headers });
      if (!res.ok) return [];
      const data = await res.json() as { conversations?: Array<{ id: string; title?: string; mode: string; createdAt: string }> };
      return data.conversations ?? [];
    } catch { return []; }
  }

  /** Auto-title a conversation from the first message */
  async function autoTitleConversation(convId: string, firstMsg: string): Promise<void> {
    const title = firstMsg.length <= 50 ? firstMsg : firstMsg.slice(0, 47).replace(/\s+\S*$/, '') + '...';
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (serverConfig.apiToken) headers['Authorization'] = `Bearer ${serverConfig.apiToken}`;
      await fetch(`${serverConfig.baseUrl}/api/chat/conversations/${convId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ title }),
      });
    } catch { /* fire-and-forget */ }
  }

  /** Ensure a conversation exists, create one if not */
  async function ensureConversation(): Promise<string | null> {
    if (conversationId) return conversationId;

    const result = await createConv(serverConfig, {
      mode: agenticMode ? 'agentic' : 'chat',
      presetId: agenticMode ? 'agentic' : 'profclaw-assistant',
    });

    if ('error' in result) {
      pushInfo(`**Error:** ${result.error}`);
      return null;
    }

    conversationId = result.conversationId;
    return conversationId;
  }

  /** Handle slash commands — returns true if handled */
  async function handleSlashCommand(cmd: string): Promise<boolean> {
    const parts = cmd.slice(1).trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'model':
      case 'm': {
        if (args[0]) {
          currentModel = args[0];
          // Update active flag in picker list
          availableModels = availableModels.map(m => ({ ...m, active: m.value === currentModel }));
          pushInfo(`Model switched to **${currentModel}**`);
        } else {
          pushInfo(`Current model: **${currentModel}** via ${currentProvider}\n\nUsage: \`/model <name>\` (e.g. \`/model gpt-4o\`, \`/model claude-opus\`, \`/model llama3.2\`)`);
        }
        return true;
      }

      case 'provider':
      case 'p': {
        if (args[0]) {
          currentProvider = args[0];
          availableProviders = availableProviders.map(p => ({ ...p, active: p.value === currentProvider }));
          pushInfo(`Provider switched to **${currentProvider}**`);
        } else {
          pushInfo(`Current provider: **${currentProvider}**\n\nUsage: \`/provider <name>\` (e.g. \`/provider ollama\`, \`/provider anthropic\`)`);
        }
        return true;
      }

      case 'agentic':
      case 'agent': {
        agenticMode = !agenticMode;
        pushInfo(`Agentic mode: **${agenticMode ? 'ON' : 'OFF'}**${agenticMode ? '\nAgent has access to web search, file ops, code execution, and more.' : ''}`);
        return true;
      }

      case 'effort': {
        const level = args[0]?.toLowerCase();
        if (level === 'low' || level === 'medium' || level === 'high') {
          effort = level;
          pushInfo(`Effort level set to **${effort}**`);
        } else {
          pushInfo(`Current effort: **${effort}**\n\nUsage: \`/effort <low|medium|high>\``);
        }
        return true;
      }

      case 'thinking': {
        showThinking = !showThinking;
        pushInfo(`Thinking display: **${showThinking ? 'ON' : 'OFF'}**`);
        return true;
      }

      case 'tools': {
        showTools = !showTools;
        pushInfo(`Tool display: **${showTools ? 'verbose' : 'minimal'}**`);
        return true;
      }

      case 'new': {
        conversationId = undefined;
        messages.length = 0;
        tokensUsed = 0;
        estimatedCost = 0;
        stepCount = 0;
        lastUserMessage = '';
        lastAssistantContent = '';
        pushInfo('Started new conversation.');
        return true;
      }

      case 'clear': {
        messages.length = 0;
        pushInfo('Display cleared. Conversation history is preserved on the server.');
        return true;
      }

      case 'sessions':
      case 'ls': {
        agentStatus = 'thinking';
        agentAction = 'Fetching sessions...';
        rerender();
        const sessions = await fetchSessions(20);
        agentStatus = 'idle';
        agentAction = undefined;
        if (sessions.length === 0) {
          pushInfo('No sessions found.');
        } else {
          const list = sessions.map(s => {
            const created = new Date(s.createdAt).toLocaleDateString();
            const title = s.title || '(untitled)';
            const modeIcon = s.mode === 'agentic' ? '🤖' : '💬';
            return `${modeIcon} \`${s.id.slice(0, 8)}\` **${title}** — ${created}`;
          }).join('\n');
          pushInfo(`**Recent Sessions:**\n\n${list}\n\nResume with: \`/resume <id>\``);
        }
        return true;
      }

      case 'resume':
      case 'switch': {
        if (!args[0]) {
          // No arg: show list and prompt
          const sessions = await fetchSessions(20);
          if (sessions.length === 0) {
            pushInfo('No sessions to resume.');
            return true;
          }
          const list = sessions.map(s => {
            const created = new Date(s.createdAt).toLocaleDateString();
            return `\`${s.id.slice(0, 8)}\` ${s.title || '(untitled)'} — ${created}`;
          }).join('\n');
          pushInfo(`**Sessions:**\n\n${list}\n\nUsage: \`/resume <id-prefix>\``);
          return true;
        }
        const sessions = await fetchSessions(50);
        const match = sessions.find(s => s.id.startsWith(args[0]));
        if (!match) {
          pushInfo(`No session found matching \`${args[0]}\`.`);
          return true;
        }
        conversationId = match.id;
        messages.length = 0;
        tokensUsed = 0;
        estimatedCost = 0;
        stepCount = 0;
        pushInfo(`Resumed session \`${match.id.slice(0, 8)}\`: **${match.title || '(untitled)'}**`);
        return true;
      }

      case 'status': {
        agentStatus = 'thinking';
        agentAction = 'Checking server...';
        rerender();
        try {
          const headers: Record<string, string> = { 'Accept': 'application/json' };
          if (serverConfig.apiToken) headers['Authorization'] = `Bearer ${serverConfig.apiToken}`;
          const res = await fetch(`${serverConfig.baseUrl}/api/chat/providers`, { headers });
          agentStatus = 'idle';
          agentAction = undefined;
          if (!res.ok) {
            pushInfo(`**Server:** ${serverConfig.baseUrl} — offline (HTTP ${res.status})`);
          } else {
            const data = await res.json() as { providers: Array<{ type: string; enabled: boolean; healthy: boolean; message?: string; latencyMs?: number }> };
            const lines = (data.providers ?? []).map(p => {
              const status = p.healthy ? '🟢' : p.enabled ? '🟡' : '⚫';
              const latency = p.latencyMs ? ` · ${p.latencyMs}ms` : '';
              return `${status} **${p.type}** ${p.message ?? ''}${latency}`;
            });
            pushInfo(`**Server:** ${serverConfig.baseUrl}\n\n${lines.join('\n')}`);
          }
        } catch (err) {
          agentStatus = 'idle';
          agentAction = undefined;
          pushInfo(`**Server:** ${serverConfig.baseUrl} — unreachable\n${err instanceof Error ? err.message : ''}`);
        }
        return true;
      }

      case 'run':
      case 'exec': {
        if (args.length === 0) {
          pushInfo('Usage: `/run <command>`');
          return true;
        }
        const cmdStr = args.join(' ');
        try {
          const { execSync } = await import('node:child_process');
          const output = execSync(cmdStr, { encoding: 'utf-8', timeout: 30000, maxBuffer: 500000 });
          pushInfo(`**$ ${cmdStr}**\n\`\`\`\n${output.trimEnd()}\n\`\`\``);
        } catch (err) {
          const e = err as { stderr?: string; message?: string };
          pushInfo(`**$ ${cmdStr}** — failed\n${e.stderr?.trim() || e.message || 'Command failed'}`);
        }
        return true;
      }

      case 'retry': {
        if (!lastUserMessage) {
          pushInfo('No previous message to retry.');
          return true;
        }
        // Optionally use a different model for retry
        if (args[0]) {
          currentModel = args[0];
          availableModels = availableModels.map(m => ({ ...m, active: m.value === currentModel }));
        }
        // Re-submit the last user message
        await handleSubmit(lastUserMessage, true);
        return true;
      }

      case 'diff': {
        agentStatus = 'thinking';
        agentAction = 'Generating diff...';
        rerender();

        const diffTracker = getSessionDiffTracker();
        const changedFiles = diffTracker.getChangedFiles();

        if (changedFiles.length === 0) {
          agentStatus = 'idle';
          agentAction = undefined;
          pushInfo('No file changes in this session.');
          return true;
        }

        const diffOutput = await diffTracker.generateDiff();
        agentStatus = 'idle';
        agentAction = undefined;

        const summary = changedFiles
          .map(f => `- \`${f.path}\` (${f.status})`)
          .join('\n');

        pushInfo(
          `**Session diff** — ${changedFiles.length} file(s) changed:\n\n${summary}\n\n\`\`\`diff\n${diffOutput.trimEnd()}\n\`\`\``,
        );
        return true;
      }

      case 'rewind': {
        const snapshotManager = getFileSnapshotManager();

        // /rewind --turn <n>
        const turnFlagIdx = args.indexOf('--turn');
        if (turnFlagIdx !== -1) {
          const turnArg = args[turnFlagIdx + 1];
          const turnIndex = parseInt(turnArg ?? '', 10);

          if (isNaN(turnIndex)) {
            pushInfo('Usage: `/rewind --turn <n>` where n is a turn number.');
            return true;
          }

          agentStatus = 'thinking';
          agentAction = `Rewinding turn ${turnIndex}...`;
          rerender();

          const results = await snapshotManager.rewindTurn(turnIndex);
          agentStatus = 'idle';
          agentAction = undefined;

          if (results.length === 0) {
            pushInfo(`No files were modified during turn ${turnIndex}.`);
            return true;
          }

          const lines = results.map(r =>
            `- \`${r.path}\` — ${r.restored ? 'restored' : 'no snapshot found'}`,
          );
          pushInfo(
            `**Rewind turn ${turnIndex}** — ${results.filter(r => r.restored).length}/${results.length} files restored:\n\n${lines.join('\n')}`,
          );
          return true;
        }

        // /rewind <path>
        if (args[0] && !args[0].startsWith('--')) {
          const filePath = args[0];

          agentStatus = 'thinking';
          agentAction = `Rewinding ${filePath}...`;
          rerender();

          const result = await snapshotManager.rewind(filePath);
          agentStatus = 'idle';
          agentAction = undefined;

          if (!result.restored) {
            pushInfo(`No snapshot found for \`${filePath}\`. The file may not have been modified this session.`);
          } else {
            pushInfo(`Rewound \`${result.path}\` to snapshot from turn ${result.turnIndex}.`);
          }
          return true;
        }

        // /rewind (no args) — list modified files
        const modifiedFiles = snapshotManager.getModifiedFiles();

        if (modifiedFiles.length === 0) {
          pushInfo('No file snapshots in this session.');
          return true;
        }

        const fileList = modifiedFiles
          .map(f => {
            const age = new Date(f.lastModified).toLocaleTimeString();
            return `- \`${f.path}\` — ${f.snapshotCount} snapshot(s), last at ${age}`;
          })
          .join('\n');

        pushInfo(
          `**Snapshots this session** (${modifiedFiles.length} file(s)):\n\n${fileList}\n\nUse \`/rewind <path>\` to restore a file, or \`/rewind --turn <n>\` to rewind all changes from a turn.`,
        );
        return true;
      }

      case 'compact': {
        const useLLM = args.includes('--llm');
        const { ContextCompactor } = await import('../../agents/context-compactor.js');

        const compactor = new ContextCompactor({
          maxContextTokens: tokensMax,
          compactionThreshold: Math.floor(tokensMax * 0.7),
          preserveRecentTurns: 5,
          summaryMaxTokens: 2_000,
        });

        // Build a ModelMessage[] from the display messages for token estimation
        const modelMessages: ModelMessage[] = messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

        const currentTokens = compactor.estimateTokens(modelMessages);
        const threshold = Math.floor(tokensMax * 0.7);

        if (currentTokens < threshold && !useLLM) {
          pushInfo(
            `No compaction needed (${currentTokens.toLocaleString()}/${tokensMax.toLocaleString()} tokens — threshold: ${threshold.toLocaleString()})`,
          );
          return true;
        }

        agentStatus = 'thinking';
        agentAction = useLLM ? 'Compacting with LLM...' : 'Compacting context...';
        rerender();

        try {
          let result;

          if (useLLM) {
            // Build an apiCall using the current server/model config
            const apiCall = async (prompt: string): Promise<string> => {
              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
              };
              if (serverConfig.apiToken) {
                headers['Authorization'] = `Bearer ${serverConfig.apiToken}`;
              }
              const res = await fetch(`${serverConfig.baseUrl}/api/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  messages: [{ role: 'user', content: prompt }],
                  model: currentModel,
                  provider: currentProvider,
                  stream: false,
                }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json() as { content?: string; message?: { content?: string } };
              return data.content ?? data.message?.content ?? '';
            };

            result = await compactor.compactWithLLM(modelMessages, apiCall);
          } else {
            result = await compactor.compact(modelMessages);
          }

          agentStatus = 'idle';
          agentAction = undefined;

          if (!result.compacted) {
            pushInfo(
              `No compaction needed (${currentTokens.toLocaleString()}/${tokensMax.toLocaleString()} tokens)`,
            );
            return true;
          }

          // Replace display messages with compacted set (convert back to display format)
          messages.length = 0;
          for (const m of result.messages) {
            if (m.role === 'system') {
              const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
              messages.push({ role: 'assistant', content, timestamp: new Date() });
            } else if (m.role === 'user' || m.role === 'assistant') {
              const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
              messages.push({ role: m.role, content, timestamp: new Date() });
            }
          }

          // Update token counter
          tokensUsed = result.compactedTokens;

          pushInfo(
            `**Context compacted** (${useLLM ? 'LLM' : 'local'} mode)\n` +
            `${result.originalTokens.toLocaleString()} → ${result.compactedTokens.toLocaleString()} tokens · ${result.turnsCompacted} turn(s) summarized`,
          );
        } catch (err) {
          agentStatus = 'idle';
          agentAction = undefined;
          pushInfo(
            `**Compaction failed:** ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
        return true;
      }

      case 'help':
      case 'h':
      case '?': {
        pushInfo([
          '**Slash Commands**',
          '',
          '**Chat**',
          '  `/model <name>` — Switch AI model (e.g. gpt-4o, claude-opus, llama3.2)',
          '  `/provider <name>` — Switch provider (anthropic, openai, ollama, etc.)',
          '  `/agentic` — Toggle agentic mode (tools + multi-step reasoning)',
          '  `/effort <low|medium|high>` — Set reasoning effort level',
          '  `/thinking` — Toggle thinking display',
          '  `/tools` — Toggle tool call verbosity',
          '',
          '**Session**',
          '  `/new` — Start a fresh conversation',
          '  `/sessions` — List recent conversations',
          '  `/resume <id>` — Switch to a previous session',
          '  `/clear` — Clear display (history preserved on server)',
          '',
          '**File Changes**',
          '  `/diff` — Show unified diff of all file changes this session',
          '  `/rewind` — List files with snapshots this session',
          '  `/rewind <path>` — Restore a file to its last snapshot',
          '  `/rewind --turn <n>` — Rewind all changes from turn N',
          '',
          '**Utilities**',
          '  `/compact` — Compact context (summarize old turns)',
          '  `/compact --llm` — Compact using LLM for richer summary',
          '  `/status` — Server and provider health',
          '  `/run <cmd>` — Execute a shell command',
          '  `/retry [model]` — Retry last message (optionally with different model)',
          '  `/help` — Show this help',
          '  `/exit` — Quit',
        ].join('\n'));
        return true;
      }

      default:
        return false;
    }
  }

  /** Send a message and stream the response via SSE */
  async function handleSubmit(userMessage: string, isRetry = false): Promise<void> {
    // Slash commands
    if (userMessage.startsWith('/')) {
      const handled = await handleSlashCommand(userMessage);
      if (handled) return;
      // Unknown slash command — fall through to send as message
    }

    // Cancel any in-flight request
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }

    if (!isRetry) {
      lastUserMessage = userMessage;
    }

    messages.push({ role: 'user', content: userMessage, timestamp: new Date() });
    agentStatus = 'thinking';
    agentAction = 'Connecting...';
    streamingContent = '';
    const startTime = Date.now();
    rerender();

    // Ensure conversation exists
    const convId = await ensureConversation();
    if (!convId) {
      agentStatus = 'error';
      streamingContent = undefined;
      rerender();
      return;
    }

    // Auto-title on first message
    const isFirstMessage = messages.filter(m => m.role === 'user').length === 1;
    if (isFirstMessage) {
      void autoTitleConversation(convId, userMessage);
    }

    agentAction = 'Waiting for response...';
    rerender();

    const abortController = new AbortController();
    activeAbort = abortController;

    let assistantStarted = false;
    let accumulatedContent = '';

    try {
      for await (const event of streamChat(serverConfig, {
        conversationId: convId,
        content: userMessage,
        model: currentModel !== 'auto' ? currentModel : undefined,
        provider: currentProvider !== 'auto' ? currentProvider : undefined,
        agentic: agenticMode,
        showThinking,
        effort,
        signal: abortController.signal,
      })) {
        if (abortController.signal.aborted) break;

        elapsedMs = Date.now() - startTime;

        switch (event.type) {
          case 'thinking_start':
          case 'thinking:start': {
            agentStatus = 'thinking';
            agentAction = 'Thinking...';
            rerender();
            break;
          }

          case 'thinking_update':
          case 'thinking:update': {
            if (showThinking) {
              const chunk = event.data.content as string;
              if (chunk) {
                streamingContent = (streamingContent ?? '') + `*${chunk}*`;
                rerender();
              }
            }
            break;
          }

          case 'thinking:end':
          case 'thinking_end': {
            // In agentic mode, thinking:end.text may contain the actual response text
            const responseText = event.data.text as string | undefined;
            if (responseText) {
              if (!assistantStarted) {
                assistantStarted = true;
                agentStatus = 'executing';
                agentAction = 'Responding...';
                streamingContent = '';
              }
              accumulatedContent += responseText;
              streamingContent = accumulatedContent;
              rerender();
            }
            break;
          }

          case 'content_delta': {
            if (!assistantStarted) {
              assistantStarted = true;
              agentStatus = 'executing';
              agentAction = 'Responding...';
              streamingContent = '';
            }
            const chunk = event.data.content as string;
            if (chunk) {
              accumulatedContent += chunk;
              streamingContent = accumulatedContent;
              rerender();
            }
            break;
          }

          case 'tool_call':
          case 'tool:call': {
            agentStatus = 'executing';
            const toolName = (event.data.name as string) || (event.data.toolName as string) || 'tool';
            const toolArgs = (event.data.arguments as Record<string, unknown>) || {};
            agentAction = `Using ${toolName}`;
            stepCount++;

            if (showTools) {
              // Verbose: show tool name + args as a message
              const argsPreview = Object.entries(toolArgs)
                .slice(0, 3)
                .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
                .join(', ');
              messages.push({
                role: 'assistant',
                content: `**Tool:** \`${toolName}\`${argsPreview ? `\n\`\`\`\n${argsPreview}\n\`\`\`` : ''}`,
                timestamp: new Date(),
              });
            }
            rerender();
            break;
          }

          case 'tool_result':
          case 'tool:result': {
            const resultName = (event.data.name as string) || (event.data.toolName as string) || 'tool';
            const succeeded = event.data.success !== false;
            const durMs = event.data.durationMs as number | undefined;

            if (showTools) {
              const durStr = durMs ? ` (${durMs}ms)` : '';
              const icon = succeeded ? '✓' : '✗';
              messages.push({
                role: 'assistant',
                content: `**${icon} ${resultName}**${durStr}`,
                timestamp: new Date(),
              });
            }
            agentAction = undefined;
            rerender();
            break;
          }

          case 'step_start':
          case 'step:start': {
            const stepNum = event.data.step as number | undefined;
            if (stepNum && stepNum > 1) {
              agentAction = `Step ${stepNum}...`;
              rerender();
            }
            break;
          }

          case 'step_complete':
          case 'step:complete': {
            agentAction = 'Processing...';
            rerender();
            break;
          }

          case 'summary': {
            const summaryText = (event.data.summary as string) || (event.data.content as string) || (event.data.text as string);
            if (summaryText && !accumulatedContent) {
              if (!assistantStarted) {
                assistantStarted = true;
                agentStatus = 'executing';
                streamingContent = '';
              }
              accumulatedContent += summaryText;
              streamingContent = accumulatedContent;
              rerender();
            }
            break;
          }

          case 'complete': {
            // Extract usage from event
            const rawUsage = event.data.usage as Record<string, unknown> | undefined;
            const totalTok = (rawUsage?.totalTokens as number) || (event.data.totalTokens as number) || 0;
            const cost = (rawUsage?.cost as number) || (event.data.cost as number) || 0;

            if (totalTok > 0) {
              tokensUsed += totalTok;
              estimatedCost += cost;
            }

            // Finalize message
            if (accumulatedContent) {
              lastAssistantContent = accumulatedContent;
              messages.push({
                role: 'assistant',
                content: accumulatedContent,
                model: currentModel !== 'auto' ? currentModel : undefined,
                timestamp: new Date(),
              });
            }

            streamingContent = undefined;
            agentStatus = 'complete';
            agentAction = undefined;
            elapsedMs = Date.now() - startTime;
            rerender();

            // Return to idle
            setTimeout(() => {
              agentStatus = 'idle';
              rerender();
            }, 1500);
            break;
          }

          case 'error': {
            const errMsg = (event.data.message as string) || 'Unknown error';
            messages.push({
              role: 'assistant',
              content: `**Error:** ${errMsg}`,
              timestamp: new Date(),
            });
            streamingContent = undefined;
            agentStatus = 'error';
            agentAction = undefined;
            rerender();

            setTimeout(() => {
              agentStatus = 'idle';
              rerender();
            }, 2000);
            break;
          }

          case 'session_start':
          case 'session:start':
          case 'user_message':
          case 'message_saved':
            // Acknowledgment events — no UI update needed
            break;

          default:
            // Forward-compatible: ignore unknown event types
            break;
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        const errMsg = err instanceof Error ? err.message : 'Stream error';
        messages.push({ role: 'assistant', content: `**Error:** ${errMsg}`, timestamp: new Date() });
        streamingContent = undefined;
        agentStatus = 'error';
        agentAction = undefined;
        rerender();

        setTimeout(() => {
          agentStatus = 'idle';
          rerender();
        }, 2000);
      }
    } finally {
      if (activeAbort === abortController) activeAbort = null;
    }
  }

  // Snapshot for Ink — all mutable state read at call time
  function buildProps() {
    return {
      sessionInfo: {
        model: currentModel,
        provider: currentProvider,
        sessionId,
        mode: (agenticMode ? 'agentic' : 'chat') as 'chat' | 'agentic',
      },
      tokensUsed,
      tokensMax,
      estimatedCost: estimatedCost > 0 ? estimatedCost : undefined,
      agentStatus,
      agentAction,
      stepCount,
      elapsedMs,
      messages: [...messages],
      streamingContent,
      availableModels,
      availableProviders,
      onSubmit: (msg: string) => { void handleSubmit(msg); },
    };
  }

  const { rerender: inkRerender, waitUntilExit } = render(
    React.createElement(ChatApp, buildProps())
  );

  rerenderFn = () => {
    inkRerender(React.createElement(ChatApp, buildProps()));
  };

  await waitUntilExit();
}

/**
 * Start interactive REPL mode
 * Uses the self-contained interactive module (extractable as standalone package)
 */
async function startREPL(options: ChatOptions): Promise<void> {
  const { startInteractiveREPL } = await import('../interactive/index.js');
  const { getConfig } = await import('../utils/config.js');
  const { detectBaseUrl } = await import('../utils/api.js');

  const config = getConfig();
  // Auto-detect the running profClaw server via shared utility
  const replBaseUrl = await detectBaseUrl();

  await startInteractiveREPL({
    server: {
      baseUrl: replBaseUrl,
      apiToken: config.apiToken,
    },
    model: options.model,
    sessionId: options.session,
    agentic: options.agentic,
    effort: 'medium',
  });
}

// === Print Mode (headless / CI) ===

/**
 * Execute a single-shot chat and print ONLY the response text to stdout.
 * No spinners, no colors, no usage stats.
 * Errors go to stderr; exit code 1 on failure.
 */
async function executePrint(message: string, options: ChatOptions): Promise<void> {
  try {
    let responseContent: string;

    if (options.agentic) {
      type WithToolsResponse = ChatResponse & {
        toolCalls?: Array<{ name: string; arguments: unknown; result?: unknown }>;
      };
      const result = await api.post<WithToolsResponse>('/api/chat/with-tools', {
        messages: [{ role: 'user', content: message }],
        model: options.model,
        presetId: 'agentic',
        enableAllTools: true,
        securityMode: 'full',
      });

      if (!result.ok || result.data?.error) {
        process.stderr.write((result.error || result.data?.error || 'Chat failed') + '\n');
        process.exit(1);
      }

      responseContent = result.data?.content ?? result.data?.message?.content ?? '';
    } else {
      const result = await api.post<ChatResponse>('/api/chat/quick', {
        prompt: message,
        model: options.model,
      });

      if (!result.ok || result.data?.error) {
        process.stderr.write((result.error || result.data?.error || 'Chat failed') + '\n');
        process.exit(1);
      }

      responseContent = result.data?.content ?? result.data?.message?.content ?? '';
    }

    process.stdout.write(responseContent + '\n');
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : 'Chat failed') + '\n');
    process.exit(1);
  }
}

/**
 * Read all of stdin until EOF and return as a string.
 */
async function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').trim()));
    process.stdin.on('error', reject);
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
    .option('--tui', 'Launch the Ink-based interactive TUI (experimental)')
    .option('-p, --print', 'Print mode: output response to stdout and exit (CI/scripts)')
    .action(async (message: string | undefined, options: ChatOptions) => {
      // --print mode: headless, stdout only, no formatting
      if (options.print) {
        let msg = message;
        if (!msg) {
          // No inline argument — try reading from stdin pipe
          if (!process.stdin.isTTY) {
            msg = await readStdin();
          }
          if (!msg) {
            process.stderr.write('Error: --print requires a message argument or piped stdin\n');
            process.exit(1);
          }
        }
        await executePrint(msg, options);
        return;
      }

      if (message) {
        // Single-shot mode
        if (options.tools || options.agentic) {
          await executeSingleShotWithTools(message, options);
        } else {
          await executeSingleShot(message, options);
        }
      } else if (options.tui) {
        // Ink TUI mode
        await startTUI(options);
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
