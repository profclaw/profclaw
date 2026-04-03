/**
 * Interactive REPL Engine
 *
 * Claude-like interactive chat with streaming, tool display,
 * slash commands, and session management.
 *
 * Self-contained module - depends only on Node.js builtins,
 * chalk, ora, and the stream-client/renderer siblings.
 *
 * @package profclaw-interactive (future standalone)
 */

import * as readline from 'node:readline';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import type {
  InteractiveOptions,
  REPLState,
  SlashCommand,
  TokenUsage,
} from './types.js';
import { createRenderer, formatElapsed, formatTokens } from './renderer.js';

// Module-level state used by slash command handlers and the REPL loop
let lastAssistantResponse = '';
let lastUserMessage = '';
let pendingRetry = '';
let activeAbort: AbortController | null = null;
let activeSpinnerInterval: ReturnType<typeof setInterval> | null = null;

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
import { streamChat, createConversation } from './stream-client.js';
import { ensureServer } from './auto-serve.js';
import { showPicker } from './picker.js';

// History file
const HISTORY_DIR = join(homedir(), '.profclaw');
const HISTORY_FILE = join(HISTORY_DIR, 'chat_history');
const SESSION_FILE = join(HISTORY_DIR, 'last_session');
const MAX_HISTORY = 500;

function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      return readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean);
    }
  } catch { /* empty */ }
  return [];
}

function saveHistory(lines: string[]): void {
  try {
    if (!existsSync(HISTORY_DIR)) {
      mkdirSync(HISTORY_DIR, { recursive: true });
    }
    writeFileSync(HISTORY_FILE, lines.slice(-MAX_HISTORY).join('\n') + '\n');
  } catch { /* empty */ }
}

function loadLastSession(): string | null {
  try {
    if (existsSync(SESSION_FILE)) {
      const data = readFileSync(SESSION_FILE, 'utf-8').trim();
      if (data) return data;
    }
  } catch { /* empty */ }
  return null;
}

function saveLastSession(conversationId: string): void {
  try {
    if (!existsSync(HISTORY_DIR)) {
      mkdirSync(HISTORY_DIR, { recursive: true });
    }
    writeFileSync(SESSION_FILE, conversationId);
  } catch { /* empty */ }
}

/** Fetch recent sessions from the server */
async function fetchSessions(serverUrl: string, limit = 10): Promise<Array<{ id: string; title?: string; mode: string; createdAt: string; messageCount?: number }>> {
  try {
    const response = await fetch(`${serverUrl}/api/chat/conversations/recent?limit=${limit}`, {
      headers: { 'Accept': 'application/json' },
    }).catch(() => null);
    if (!response || !response.ok) return [];
    const data = await response.json() as { conversations?: Array<{ id: string; title?: string; mode: string; createdAt: string; messageCount?: number }> };
    return data.conversations || [];
  } catch { return []; }
}

/** Auto-generate a session title from the first message (fire-and-forget) */
async function autoTitleSession(serverUrl: string, conversationId: string, firstMessage: string): Promise<void> {
  // Generate a short title from the first message (truncate to ~50 chars)
  const title = firstMessage.length <= 50
    ? firstMessage
    : firstMessage.slice(0, 47).replace(/\s+\S*$/, '') + '...';

  try {
    await fetch(`${serverUrl}/api/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => null);
  } catch { /* fire-and-forget */ }
}

// Banner

function printBanner(state: REPLState): void {
  const H = '\u2500';
  const DOT = '\u00b7';
  const w = Math.min((process.stdout.columns || 80) - 4, 68);
  const gold = chalk.hex('#F6C453');
  const border = chalk.hex('#3C414B');
  const dim = chalk.dim;

  console.log('');
  console.log('  ' + border(H.repeat(w)));
  console.log('  ' + gold.bold('profClaw'));
  const mode = state.agenticMode ? gold('agentic') : dim('chat');
  const model = dim(state.model || 'default');
  const sessionInfo = state.session ? dim(`resumed ${state.session.conversationId.slice(0, 8)}`) : dim('new session');
  console.log(`  ${mode} ${dim(DOT)} ${model} ${dim(DOT)} ${sessionInfo} ${dim(DOT)} ${dim('/help')}`);
  console.log('  ' + border(H.repeat(w)));
  console.log('');
}

// Slash Commands

function buildCommands(): SlashCommand[] {
  return [
    {
      name: 'help',
      aliases: ['?', 'h'],
      description: 'Show available commands',
      handler: (_args, _state) => {
        const d = chalk.dim;
        const c = chalk.cyan;
        console.log('');
        console.log(d('  Chat'));
        console.log(`    ${c('/model')} <name>    ${d('sonnet, opus, haiku, gpt-4o, llama3.2')}`);
        console.log(`    ${c('/agentic')}         ${d('toggle agentic mode (tools + multi-step)')}`);
        console.log(`    ${c('/effort')} <level>  ${d('low, medium, high')}`);
        console.log(`    ${c('/thinking')}        ${d('toggle thinking display')}`);
        console.log('');
        console.log(d('  Automation'));
        console.log(`    ${c('/cron')} [list|add] ${d('manage scheduled jobs')}`);
        console.log(`    ${c('/feeds')} [list]    ${d('manage RSS feeds')}`);
        console.log('');
        console.log(d('  Tools'));
        console.log(`    ${c('/run')} <cmd>       ${d('run shell command (!cmd shortcut)')}`);
        console.log(`    ${c('/copy')}            ${d('copy last response to clipboard')}`);
        console.log(`    ${c('/save')} <file>     ${d('save last response to file')}`);
        console.log(`    ${c('/retry')} [model]    ${d('retry last message (optionally with different model)')}`);
        console.log(`    ${c('/status')}          ${d('server & provider status')}`);
        console.log(`    ${c('/providers')}       ${d('list AI providers')}`);
        console.log(`    ${c('/tools')}           ${d('list available tools')}`);
        console.log(`    ${c('/skills')} [list|install|search] ${d('manage skills')}`);
        console.log(`    ${c('/whoami')}          ${d('show current config')}`);
        console.log('');
        console.log(d('  Session'));
        console.log(`    ${c('/sessions')}        ${d('list recent conversations')}`);
        console.log(`    ${c('/resume')} <id>     ${d('switch to a previous session')}`);
        console.log(`    ${c('/new')}             ${d('start fresh session')}`);
        console.log(`    ${c('/session')}         ${d('show current session info')}`);
        console.log(`    ${c('/compact')}         ${d('compact history to save tokens')}`);
        console.log(`    ${c('/clear')}           ${d('clear screen')}`);
        console.log(`    ${c('/exit')}            ${d('quit')}`);
        console.log('');
        console.log(d('  Ctrl+C clear \u00b7 2x exit \u00b7 Ctrl+D quit'));
        console.log(d('  Alt+Enter newline \u00b7 Ctrl+L clear \u00b7 Ctrl+P sessions \u00b7 Shift+Tab thinking'));
        console.log('');
      },
    },
    {
      name: 'exit',
      aliases: ['quit', 'q'],
      description: 'Exit chat',
      handler: () => {
        // Will be replaced with exitGracefully at runtime
        process.exit(0);
      },
    },
    {
      name: 'clear',
      aliases: ['cls'],
      description: 'Clear screen',
      handler: () => {
        console.clear();
      },
    },
    {
      name: 'new',
      aliases: ['reset'],
      description: 'Start new session',
      handler: async (_args, state) => {
        state.session = null;
        state.sessionTokens = 0;
        state.sessionCost = 0;
        state.messageCount = 0;
        // Clear saved session so next launch also starts fresh
        try { const { unlinkSync } = require('fs'); unlinkSync(join(homedir(), '.profclaw', 'last_session')); } catch { /* ok */ }
        console.log(chalk.dim('  New session. Next message starts fresh.'));
      },
    },
    {
      name: 'session',
      aliases: ['sess'],
      description: 'Show session info',
      handler: (_args, state) => {
        if (!state.session) {
          console.log(chalk.dim('  No active session. Send a message to start one.'));
          return;
        }
        const d = chalk.dim;
        console.log('');
        console.log(`  ${d('id')}      ${chalk.cyan(state.session.conversationId.slice(0, 12))}`);
        console.log(`  ${d('mode')}    ${state.agenticMode ? chalk.hex('#F6C453')('agentic') : 'chat'}`);
        console.log(`  ${d('model')}   ${state.model || 'default'}`);
        console.log(`  ${d('msgs')}    ${state.messageCount}`);
        console.log(`  ${d('tokens')}  ${formatTokens(state.sessionTokens)}`);
        if (state.sessionCost > 0) console.log(`  ${d('cost')}    $${state.sessionCost.toFixed(4)}`);
        console.log('');
      },
    },
    {
      name: 'sessions',
      aliases: ['ls'],
      description: 'Pick a session to resume',
      handler: async (_args, state) => {
        const sessions = await fetchSessions(state.serverUrl, 20);
        if (sessions.length === 0) {
          console.log(chalk.dim('  No sessions found.'));
          return;
        }

        const selected = await showPicker({
          title: 'Sessions',
          filterable: true,
          pageSize: 8,
          items: sessions.map((s) => ({
            id: s.id,
            label: s.title || '(untitled)',
            description: formatRelativeTime(s.createdAt),
            dimLabel: !s.title,
          })),
        });

        if (!selected) return; // Cancelled

        const match = sessions.find((s) => s.id === selected);
        if (!match) return;

        state.session = {
          conversationId: match.id,
          mode: state.agenticMode ? 'agentic' : 'chat',
          title: match.title,
          totalTokens: 0,
          totalCost: 0,
          messageCount: 0,
          createdAt: new Date(match.createdAt),
        };
        state.sessionTokens = 0;
        state.sessionCost = 0;
        state.messageCount = 0;
        saveLastSession(match.id);
        console.log(chalk.dim(`  Resumed: ${match.title || match.id.slice(0, 8)}`));
      },
    },
    {
      name: 'resume',
      aliases: ['switch'],
      description: 'Resume a session (or pick)',
      args: '[session-id]',
      handler: async (args, state) => {
        if (!args[0]) {
          // No arg - show session picker
          const sessions = await fetchSessions(state.serverUrl, 20);
          if (sessions.length === 0) { console.log(chalk.dim('  No sessions.')); return; }
          const selected = await showPicker({
            title: 'Resume Session',
            filterable: true,
            pageSize: 8,
            items: sessions.map((s) => ({
              id: s.id,
              label: s.title || '(untitled)',
              description: formatRelativeTime(s.createdAt),
              dimLabel: !s.title,
            })),
          });
          if (!selected) return;
          args = [selected];
        }
        const prefix = args[0];
        const sessions = await fetchSessions(state.serverUrl, 50);
        const match = sessions.find((s) => s.id.startsWith(prefix));

        if (!match) {
          console.log(chalk.dim(`  No session matching "${prefix}".`));
          return;
        }

        state.session = {
          conversationId: match.id,
          mode: state.agenticMode ? 'agentic' : 'chat',
          title: match.title,
          totalTokens: 0,
          totalCost: 0,
          messageCount: 0,
          createdAt: new Date(match.createdAt),
        };
        state.sessionTokens = 0;
        state.sessionCost = 0;
        state.messageCount = 0;
        saveLastSession(match.id);
        console.log(chalk.dim(`  Resumed: ${match.title || match.id.slice(0, 8)}`));
      },
    },
    {
      name: 'compact',
      aliases: [],
      description: 'Compact conversation history to save tokens',
      handler: async (_args, state) => {
        if (!state.session) {
          console.log(chalk.dim('  No active session.'));
          return;
        }
        try {
          const response = await fetch(`${state.serverUrl}/api/chat/conversations/${state.session.conversationId}/compact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }).catch(() => null);
          if (response?.ok) {
            console.log(chalk.dim('  History compacted. Older messages summarized to save tokens.'));
          } else {
            console.log(chalk.dim('  Compact not available for this conversation.'));
          }
        } catch {
          console.log(chalk.dim('  Failed to compact.'));
        }
      },
    },
    {
      name: 'model',
      aliases: ['m'],
      description: 'Pick or set model',
      args: '[name]',
      handler: async (args, state) => {
        if (args.length > 0) {
          state.model = args[0];
          console.log(chalk.green(`  Model: ${state.model}`));
          return;
        }
        const selected = await showPicker({
          title: `Model (current: ${state.model || 'default'})`,
          items: [
            { id: 'gpt4o', label: 'GPT-4o', description: 'Azure' },
            { id: 'gpt4o-mini', label: 'GPT-4o Mini', description: 'Azure fast' },
            { id: 'gpt-4.1', label: 'GPT-4.1', description: 'Azure latest' },
            { id: 'sonnet', label: 'Claude Sonnet', description: 'Anthropic' },
            { id: 'opus', label: 'Claude Opus', description: 'Anthropic' },
            { id: 'haiku', label: 'Claude Haiku', description: 'Anthropic fast' },
            { id: 'gemini-2.0-flash', label: 'Gemini Flash', description: 'Google' },
            { id: 'llama3.2', label: 'Llama 3.2', description: 'Ollama local' },
            { id: 'llama-3.3-70b', label: 'Llama 3.3 70B', description: 'Cerebras' },
          ],
          filterable: true,
          pageSize: 9,
        });
        if (selected) {
          state.model = selected;
          console.log(chalk.green(`  Model: ${state.model}`));
        }
      },
    },
    {
      name: 'agentic',
      aliases: ['agent', 'a'],
      description: 'Toggle agentic mode',
      handler: (_args, state) => {
        state.agenticMode = !state.agenticMode;
        console.log(chalk.green(`  Agentic mode: ${state.agenticMode ? chalk.yellow('enabled') : 'disabled'}`));
        if (state.agenticMode) {
          console.log(chalk.dim('  Agent has access to all tools (web search, file ops, code execution, etc.)'));
        }
      },
    },
    {
      name: 'tools',
      aliases: ['t'],
      description: 'Toggle tool display',
      handler: (_args, state) => {
        state.showTools = !state.showTools;
        console.log(chalk.green(`  Tool display: ${state.showTools ? 'shown' : 'hidden'}`));
      },
    },
    {
      name: 'thinking',
      aliases: ['think'],
      description: 'Toggle thinking display',
      handler: (_args, state) => {
        state.showThinking = !state.showThinking;
        console.log(chalk.green(`  Thinking: ${state.showThinking ? 'shown' : 'hidden'}`));
      },
    },
    {
      name: 'usage',
      aliases: ['u'],
      description: 'Toggle usage display',
      handler: (_args, state) => {
        state.showUsage = !state.showUsage;
        console.log(chalk.green(`  Usage display: ${state.showUsage ? 'shown' : 'hidden'}`));
      },
    },
    {
      name: 'effort',
      aliases: ['e'],
      description: 'Set thinking effort level',
      args: '<low|medium|high>',
      handler: (args, state) => {
        const level = args[0] as 'low' | 'medium' | 'high' | undefined;
        if (!level || !['low', 'medium', 'high'].includes(level)) {
          console.log(chalk.dim(`  Current effort: ${state.effort}`));
          console.log(chalk.dim('  Options: low (fast), medium (balanced), high (thorough)'));
          return;
        }
        state.effort = level;
        console.log(chalk.green(`  Effort set to: ${state.effort}`));
      },
    },
    {
      name: 'status',
      aliases: ['st'],
      description: 'Server and provider status',
      handler: async (_args, state) => {
        try {
          const [health, providers] = await Promise.all([
            fetch(`${state.serverUrl}/health`).then((r) => r.json()).catch(() => null) as Promise<Record<string, unknown> | null>,
            fetch(`${state.serverUrl}/api/chat/providers`).then((r) => r.json()).catch(() => null) as Promise<Record<string, unknown> | null>,
          ]);

          const d = chalk.dim;
          console.log('');
          if (health) {
            console.log(`  ${d('server')}  ${chalk.hex('#7DD3A5')('online')} ${d(`v${health.version}`)} ${d(`(${health.mode})`)}`);
          } else {
            console.log(`  ${d('server')}  ${chalk.hex('#F97066')('offline')}`);
          }

          if (providers) {
            const provList = providers.providers as Array<{ type: string; enabled: boolean; healthy: boolean; message?: string }>;
            const defaultProv = providers.default as string;
            for (const p of provList || []) {
              const icon = p.healthy ? chalk.hex('#7DD3A5')('\u2713') : chalk.hex('#F97066')('\u2717');
              const isDefault = p.type === defaultProv ? chalk.hex('#F6C453')(' *') : '';
              console.log(`  ${d('provider')} ${icon} ${p.type}${isDefault}`);
            }
          }
          console.log('');
        } catch {
          console.log(chalk.dim('  Cannot reach server.'));
        }
      },
    },
    {
      name: 'run',
      aliases: ['exec', '!'],
      description: 'Run a shell command',
      args: '<command>',
      handler: async (args, _state) => {
        if (args.length === 0) {
          console.log(chalk.dim('  Usage: /run <command>  or  !<command>'));
          return;
        }
        const cmd = args.join(' ');
        console.log(chalk.dim(`  $ ${cmd}`));
        try {
          const { execSync } = await import('node:child_process');
          const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000, maxBuffer: 100000 });
          if (output.trim()) console.log(output.trimEnd());
        } catch (err) {
          const e = err as { stderr?: string; message?: string };
          console.log(chalk.hex('#F97066')(`  ${e.stderr?.trim() || e.message || 'Command failed'}`));
        }
      },
    },
    {
      name: 'copy',
      aliases: ['cp'],
      description: 'Copy last response to clipboard',
      handler: async (_args, _state) => {
        // lastResponse is captured from the stream buffer
        try {
          const { execSync } = await import('node:child_process');
          const text = lastAssistantResponse;
          if (!text) {
            console.log(chalk.dim('  No response to copy.'));
            return;
          }
          execSync('pbcopy', { input: text, encoding: 'utf-8' });
          console.log(chalk.dim('  Copied to clipboard.'));
        } catch {
          console.log(chalk.dim('  Clipboard not available (pbcopy not found).'));
        }
      },
    },
    {
      name: 'save',
      aliases: [],
      description: 'Save last response to a file',
      args: '<filename>',
      handler: async (args, _state) => {
        if (!args[0]) {
          console.log(chalk.dim('  Usage: /save <filename>'));
          return;
        }
        if (!lastAssistantResponse) {
          console.log(chalk.dim('  No response to save.'));
          return;
        }
        try {
          writeFileSync(args[0], lastAssistantResponse, 'utf-8');
          console.log(chalk.dim(`  Saved to ${args[0]}`));
        } catch (err) {
          console.log(chalk.dim(`  Failed: ${err instanceof Error ? err.message : 'unknown'}`));
        }
      },
    },
    {
      name: 'retry',
      aliases: ['r'],
      description: 'Retry last message (optionally with different model)',
      args: '[model]',
      handler: async (args, state) => {
        if (!lastUserMessage) {
          console.log(chalk.dim('  No message to retry.'));
          return;
        }
        // Optionally switch model for comparison
        const prevModel = state.model;
        if (args[0]) {
          state.model = args[0];
          console.log(chalk.dim(`  Retrying with ${state.model} (was: ${prevModel || 'default'})`));
          if (state.lastResponseCache) {
            console.log(chalk.dim(`  Previous (${state.lastResponseCache.model}): ${state.lastResponseCache.content.slice(0, 80)}${state.lastResponseCache.content.length > 80 ? '...' : ''}`));
          }
        } else {
          console.log(chalk.dim(`  Retrying: ${lastUserMessage.slice(0, 50)}...`));
        }
        pendingRetry = lastUserMessage;
      },
    },
    {
      name: 'skills',
      aliases: [],
      description: 'Manage skills',
      args: '[list|install <source>|search <query>]',
      handler: async (args, state) => {
        const sub = args[0] || 'list';

        if (sub === 'list') {
          try {
            const response = await fetch(`${state.serverUrl}/api/skills`).catch(() => null);
            if (!response?.ok) { console.log(chalk.dim('  Cannot fetch skills.')); return; }
            const data = await response.json() as { stats?: { total: number; eligible: number }; skills?: Array<{ name: string; description?: string; source?: string }> };
            const skills = data.skills || [];
            const d = chalk.dim;
            console.log('');
            console.log(`  ${data.stats?.total || 0} skills loaded, ${data.stats?.eligible || 0} eligible`);
            console.log('');
            const bySource = new Map<string, string[]>();
            for (const s of skills) {
              const src = s.source || 'bundled';
              if (!bySource.has(src)) bySource.set(src, []);
              bySource.get(src)!.push(s.name);
            }
            for (const [src, names] of bySource) {
              console.log(d(`  ${src}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` +${names.length - 8} more` : ''}`));
            }
            console.log('');
          } catch { console.log(chalk.dim('  Cannot fetch skills.')); }
          return;
        }

        if (sub === 'install') {
          const source = args.slice(1).join(' ');
          if (!source) {
            console.log(chalk.dim('  Usage: /skills install <github-user/repo> or <url>'));
            console.log(chalk.dim('  Example: /skills install blader/humanizer'));
            return;
          }
          console.log(chalk.dim(`  Installing skill from ${source}...`));
          try {
            const response = await fetch(`${state.serverUrl}/api/skills/marketplace/install`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ source }),
            }).catch(() => null);
            if (!response?.ok) {
              console.log(chalk.hex('#F97066')('  Install failed. Check the source URL.'));
              return;
            }
            const data = await response.json() as { data?: { skillName?: string; version?: string } };
            console.log(chalk.hex('#7DD3A5')(`  Installed: ${data.data?.skillName || source} v${data.data?.version || '?'}`));
          } catch {
            console.log(chalk.hex('#F97066')('  Install failed.'));
          }
          return;
        }

        if (sub === 'search') {
          const query = args.slice(1).join(' ');
          if (!query) {
            console.log(chalk.dim('  Usage: /skills search <query>'));
            return;
          }
          console.log(chalk.dim(`  Searching ClawHub for "${query}"...`));
          try {
            const response = await fetch(`${state.serverUrl}/api/skills/marketplace/search?q=${encodeURIComponent(query)}`).catch(() => null);
            if (!response?.ok) {
              console.log(chalk.dim('  No results or registry unavailable.'));
              return;
            }
            const data = await response.json() as { data?: Array<{ name: string; description?: string; installs?: number }> };
            const results = data.data || [];
            if (results.length === 0) {
              console.log(chalk.dim('  No skills found.'));
              return;
            }
            console.log('');
            for (const r of results.slice(0, 10)) {
              console.log(`  ${chalk.cyan(r.name)} ${chalk.dim(r.description || '')} ${chalk.dim(`(${r.installs || 0} installs)`)}`);
            }
            console.log('');
            console.log(chalk.dim('  Install: /skills install <name>'));
          } catch {
            console.log(chalk.dim('  Search failed.'));
          }
          return;
        }

        console.log(chalk.dim('  Usage: /skills [list|install <source>|search <query>]'));
      },
    },
    {
      name: 'tools',
      aliases: [],
      description: 'List available tools',
      handler: async (_args, state) => {
        try {
          const response = await fetch(`${state.serverUrl}/api/tools`).catch(() => null);
          if (!response?.ok) { console.log(chalk.dim('  Cannot fetch tools.')); return; }
          const data = await response.json() as { tools?: Array<{ name: string; category: string }> };
          const tools = data.tools || [];
          const byCategory = new Map<string, string[]>();
          for (const t of tools) {
            const cat = t.category || 'other';
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push(t.name);
          }
          console.log('');
          for (const [cat, names] of byCategory) {
            console.log(chalk.dim(`  ${cat}: ${names.join(', ')}`));
          }
          console.log(chalk.dim(`\n  ${tools.length} tools total`));
          console.log('');
        } catch { console.log(chalk.dim('  Cannot fetch tools.')); }
      },
    },
    {
      name: 'providers',
      aliases: ['p'],
      description: 'List AI providers',
      handler: async (_args, state) => {
        try {
          const response = await fetch(`${state.serverUrl}/api/chat/providers`).catch(() => null);
          if (!response?.ok) { console.log(chalk.dim('  Cannot fetch providers.')); return; }
          const data = await response.json() as { default: string; providers: Array<{ type: string; enabled: boolean; healthy: boolean }> };
          console.log('');
          for (const p of data.providers) {
            const icon = p.healthy ? chalk.hex('#7DD3A5')('\u2713') : chalk.hex('#F97066')('\u2717');
            const def = p.type === data.default ? chalk.hex('#F6C453')(' (default)') : '';
            console.log(`  ${icon} ${p.type}${def}`);
          }
          console.log('');
        } catch { console.log(chalk.dim('  Cannot fetch providers.')); }
      },
    },
    {
      name: 'whoami',
      aliases: [],
      description: 'Show current config',
      handler: (_args, state) => {
        const d = chalk.dim;
        console.log('');
        console.log(`  ${d('mode')}      ${state.agenticMode ? chalk.hex('#F6C453')('agentic') : 'chat'}`);
        console.log(`  ${d('model')}     ${state.model || 'default'}`);
        console.log(`  ${d('effort')}    ${state.effort}`);
        console.log(`  ${d('thinking')}  ${state.showThinking ? 'shown' : 'hidden'}`);
        console.log(`  ${d('tools')}     ${state.showTools ? 'shown' : 'hidden'}`);
        console.log(`  ${d('usage')}     ${state.showUsage ? 'shown' : 'hidden'}`);
        console.log(`  ${d('server')}    ${state.serverUrl}`);
        if (state.session) {
          console.log(`  ${d('session')}   ${state.session.conversationId.slice(0, 12)}`);
          console.log(`  ${d('messages')}  ${state.messageCount}`);
          console.log(`  ${d('tokens')}    ${formatTokens(state.sessionTokens)}`);
        }
        console.log('');
      },
    },
    {
      name: 'plugins',
      aliases: ['plugin'],
      description: 'Manage plugins',
      args: '[list|load <path>|unload <id>]',
      handler: async (args, state) => {
        const sub = args[0] || 'list';

        if (sub === 'list') {
          try {
            const response = await fetch(`${state.serverUrl}/api/plugins`).catch(() => null);
            if (!response?.ok) {
              console.log(chalk.dim('  No plugins loaded. Plugins require pro mode.'));
              return;
            }
            const data = await response.json() as { plugins?: Array<{ id: string; name: string; version: string; tools: number }> };
            const plugins = data.plugins || [];
            if (plugins.length === 0) {
              console.log(chalk.dim('  No plugins loaded.'));
              console.log(chalk.dim('  Install: ~/.profclaw/plugins/<name>/index.js'));
              return;
            }
            console.log('');
            for (const p of plugins) {
              console.log(`  ${chalk.cyan(p.name)} v${p.version} ${chalk.dim(`(${p.tools} tools)`)}`);
            }
            console.log('');
          } catch { console.log(chalk.dim('  Cannot fetch plugins.')); }
          return;
        }

        console.log(chalk.dim('  Usage: /plugins [list|load <path>|unload <id>]'));
      },
    },
    {
      name: 'cron',
      aliases: [],
      description: 'List or manage scheduled jobs',
      args: '[list|add|trigger <id>]',
      handler: async (args, state) => {
        const sub = args[0] || 'list';

        if (sub === 'list') {
          try {
            const response = await fetch(`${state.serverUrl}/api/cron`, {
              headers: { 'Accept': 'application/json' },
            }).catch(() => null);

            if (!response || !response.ok) {
              console.log(chalk.dim('  Could not fetch cron jobs. Is the server running?'));
              return;
            }

            const data = await response.json() as { jobs?: Array<{ name: string; jobType: string; cronExpression?: string; status: string; lastRunStatus?: string }> };
            const jobs = data.jobs || [];

            if (jobs.length === 0) {
              console.log(chalk.dim('  No cron jobs configured.'));
              console.log(chalk.dim('  Create one in chat: "Set up a daily AI news digest at 7am and send to my Telegram"'));
              return;
            }

            console.log('');
            console.log(chalk.bold(`  ${jobs.length} Cron Jobs:`));
            for (const job of jobs) {
              const statusIcon = job.status === 'active' ? chalk.green('active') : chalk.yellow(job.status);
              const schedule = job.cronExpression || 'event-driven';
              console.log(`  ${chalk.cyan(job.name)} (${job.jobType}) - ${schedule} [${statusIcon}]`);
            }
            console.log('');
          } catch {
            console.log(chalk.dim('  Could not connect to server.'));
          }
          return;
        }

        if (sub === 'add') {
          console.log(chalk.dim('  To create a cron job, describe what you want in the chat:'));
          console.log(chalk.dim('  Example: "Every weekday at 7am, search for AI news and send a summary to my Telegram"'));
          console.log(chalk.dim('  The agent will use the cron_create tool to set it up.'));
          return;
        }

        console.log(chalk.dim('  Usage: /cron [list|add]'));
      },
    },
    {
      name: 'feeds',
      aliases: ['feed'],
      description: 'Manage RSS feeds',
      args: '[list|add <url>|bundles|poll]',
      handler: async (args, state) => {
        const sub = args[0] || 'list';

        if (sub === 'list') {
          try {
            const response = await fetch(`${state.serverUrl}/api/feeds`, {
              headers: { 'Accept': 'application/json' },
            }).catch(() => null);

            if (!response || !response.ok) {
              console.log(chalk.dim('  Could not fetch feeds. Is the server running?'));
              return;
            }

            const data = await response.json() as { data?: Array<{ name: string; category: string; articleCount: number; enabled: boolean }> };
            const feeds = data.data || [];

            if (feeds.length === 0) {
              console.log(chalk.dim('  No feeds configured. Install a bundle:'));
              console.log(chalk.dim('  /feeds bundles     - List available bundles'));
              console.log(chalk.dim('  Or in chat: "Add the AI news feed bundle"'));
              return;
            }

            console.log('');
            console.log(chalk.bold(`  ${feeds.length} Feeds:`));
            for (const feed of feeds) {
              const status = feed.enabled ? chalk.green('on') : chalk.dim('off');
              console.log(`  ${chalk.cyan(feed.name)} (${feed.category}) - ${feed.articleCount} articles [${status}]`);
            }
            console.log('');
          } catch {
            console.log(chalk.dim('  Could not connect to server.'));
          }
          return;
        }

        if (sub === 'bundles') {
          console.log('');
          console.log(chalk.bold('  Available Feed Bundles:'));
          console.log(`  ${chalk.cyan('ai-news')}     - OpenAI, Anthropic, HuggingFace, TechCrunch AI, MIT Tech Review`);
          console.log(`  ${chalk.cyan('dev-news')}    - Hacker News, Lobsters, Dev.to`);
          console.log(`  ${chalk.cyan('security')}    - Krebs, The Hacker News, Schneier`);
          console.log('');
          console.log(chalk.dim('  Install in chat: "Install the ai-news feed bundle"'));
          return;
        }

        if (sub === 'poll') {
          console.log(chalk.dim('  In chat: "Poll all feeds for new articles"'));
          return;
        }

        if (sub === 'add') {
          const url = args[1];
          if (!url) {
            console.log(chalk.dim('  Usage: /feeds add <url>'));
            console.log(chalk.dim('  Or in chat: "Add this RSS feed: https://example.com/feed.xml"'));
            return;
          }
          console.log(chalk.dim(`  In chat: "Add an RSS feed from ${url}"`));
          return;
        }

        console.log(chalk.dim('  Usage: /feeds [list|add <url>|bundles|poll]'));
      },
    },
  ];
}

// Main REPL

export async function startInteractiveREPL(options: InteractiveOptions): Promise<void> {
  const render = createRenderer();
  const commands = buildCommands();
  const history = loadHistory();

  // Multiline input state
  let multilineBuffer: string[] = [];
  let isMultiline = false;

  // Initialize state
  const state: REPLState = {
    session: null,
    model: options.model,
    provider: options.provider,
    agenticMode: options.agentic ?? true, // Always agentic by default - that's the point
    showThinking: options.showThinking ?? false,
    showTools: true,
    showUsage: true,
    effort: options.effort || 'medium',
    isStreaming: false,
    sessionTokens: 0,
    sessionCost: 0,
    messageCount: 0,
    serverUrl: options.server.baseUrl,
  };

  // Resume session: explicit > last saved > new
  const sessionToResume = options.sessionId || loadLastSession();
  if (sessionToResume) {
    state.session = {
      conversationId: sessionToResume,
      mode: state.agenticMode ? 'agentic' : 'chat',
      totalTokens: 0,
      totalCost: 0,
      messageCount: 0,
      createdAt: new Date(),
    };
  }

  // Ensure server is running (auto-start if needed)
  const serverCheck = await ensureServer(options.server.baseUrl, { autoStart: true });
  if (!serverCheck.ok) {
    console.log(chalk.red('  ' + (serverCheck.error || 'Cannot connect to server')));
    console.log('');
    console.log(chalk.dim('  To start manually:'));
    console.log(chalk.dim('    pnpm dev          # Development mode (with hot reload)'));
    console.log(chalk.dim('    pnpm start        # Production mode'));
    console.log('');
    process.exit(1);
  }

  // State variables for /copy, /save, /retry are at module level

  // Dynamic prompt builder - shows session context inline
  const updatePrompt = (): void => {
    const parts: string[] = [];
    if (state.model) parts.push(state.model);
    if (state.sessionTokens > 0) parts.push(formatTokens(state.sessionTokens));
    const promptStr = parts.length > 0
      ? chalk.dim(`${parts.join(' \u00b7 ')} > `)
      : chalk.dim('> ');
    rl.setPrompt(promptStr);
  };

  printBanner(state);

  // Load and show recent history for resumed sessions
  if (state.session) {
    try {
      const response = await fetch(`${options.server.baseUrl}/api/chat/conversations/${state.session.conversationId}/messages?limit=6`).catch(() => null);
      if (response?.ok) {
        const data = await response.json() as { messages?: Array<{ role: string; content: string }> };
        const msgs = data.messages || [];
        if (msgs.length > 0) {
          console.log(chalk.dim('  Recent history:'));
          for (const m of msgs.slice(-6)) {
            const role = m.role === 'user' ? chalk.dim('  you: ') : chalk.dim('  ai:  ');
            const preview = m.content.slice(0, 60).replace(/\n/g, ' ');
            console.log(`${role}${chalk.dim(preview)}${m.content.length > 60 ? chalk.dim('...') : ''}`);
          }
          console.log('');
        }
      }
    } catch { /* skip history load errors */ }
  }

  // Keep stdin flowing so readline doesn't auto-close after async handlers
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }

  // Build slash command completions with descriptions
  const commandEntries = commands.map((c) => ({
    cmd: `/${c.name}`,
    desc: c.description,
    args: c.args || '',
  }));

  // Tab completer - shows formatted list with descriptions
  const completer = (line: string): [string[], string] => {
    if (line.startsWith('/')) {
      const prefix = line.toLowerCase();
      const matches = commandEntries.filter((e) => e.cmd.startsWith(prefix));

      if (matches.length === 0) {
        return [commandEntries.map((e) => e.cmd), line];
      }

      if (matches.length === 1) {
        // Exact single match - auto-complete it
        const suffix = matches[0].args ? ' ' : '';
        return [[matches[0].cmd + suffix], line];
      }

      // Multiple matches - show with descriptions
      // Readline displays these as the "options" list
      const display = matches.map((e) => {
        const padded = e.cmd.padEnd(16);
        return `${padded}${e.desc}`;
      });

      // Return just the command names for actual completion
      return [display, line];
    }
    return [[], line];
  };

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.dim('> '),
    history,
    historySize: MAX_HISTORY,
    removeHistoryDuplicates: true,
    terminal: true,
    completer,
  });

  // Keybindings via keypress events
  if (process.stdin.isTTY) {
    let pasteBuffer = '';
    let pasteTimer: ReturnType<typeof setTimeout> | null = null;

    process.stdin.on('keypress', (_ch: string, key: { name: string; meta: boolean; shift: boolean; ctrl: boolean; sequence: string }) => {
      if (!key) return;

      // Alt+Enter: multiline input
      if (key.name === 'return' && key.meta) {
        multilineBuffer.push(rl.line);
        (rl as unknown as { line: string; cursor: number }).line = '';
        (rl as unknown as { cursor: number }).cursor = 0;
        process.stdout.write('\n' + chalk.dim('  ... '));
        isMultiline = true;
        return;
      }

      // Ctrl+L: clear screen (keep prompt)
      if (key.ctrl && key.name === 'l') {
        console.clear();
        printBanner(state);
        rl.prompt(true);
        return;
      }

      // Ctrl+P: session picker
      if (key.ctrl && key.name === 'p') {
        if (!state.isStreaming) {
          const sessCmd = commands.find((c) => c.name === 'sessions');
          if (sessCmd) {
            const result = sessCmd.handler([], state);
            if (result instanceof Promise) result.then(() => { updatePrompt(); rl.prompt(); });
          }
        }
        return;
      }

      // Shift+Tab: toggle thinking display
      if (key.shift && key.name === 'tab') {
        state.showThinking = !state.showThinking;
        process.stdout.write(`\r\x1b[K${chalk.dim(`  Thinking: ${state.showThinking ? 'shown' : 'hidden'}`)}\n`);
        rl.prompt(true);
        return;
      }

      // Paste detection: rapid character input (burst coalescer)
      if (!key.ctrl && !key.meta && _ch && _ch.length === 1 && _ch >= ' ') {
        pasteBuffer += _ch;
        if (pasteTimer) clearTimeout(pasteTimer);
        pasteTimer = setTimeout(() => {
          // If we got 5+ chars in a burst, it was a paste
          if (pasteBuffer.length >= 5 && pasteBuffer.includes('\n')) {
            // Convert pasted newlines to multiline mode
            const lines = pasteBuffer.split('\n');
            if (lines.length > 1) {
              // First line is already in readline, add rest to multiline buffer
              for (let i = 0; i < lines.length - 1; i++) {
                multilineBuffer.push(lines[i]);
              }
              isMultiline = true;
              process.stdout.write(`\n${chalk.dim(`  ... (${lines.length} lines pasted)`)}\n`);
              const lastLine = lines[lines.length - 1];
              (rl as unknown as { line: string; cursor: number }).line = lastLine;
              (rl as unknown as { cursor: number }).cursor = lastLine.length;
              rl.prompt(true);
            }
          }
          pasteBuffer = '';
        }, 10); // 10ms window for paste detection
      }
    });
  }

  // Track Ctrl+C for double-tap exit
  let lastCtrlC = 0;

  rl.on('SIGINT', () => {
    const now = Date.now();
    if (state.isStreaming) {
      // Cancel stream, spinner, and fetch
      if (activeAbort) { activeAbort.abort(); activeAbort = null; }
      if (activeSpinnerInterval) { clearInterval(activeSpinnerInterval); activeSpinnerInterval = null; }
      process.stdout.write('\r\x1b[K'); // Clear spinner line
      state.isStreaming = false;
      console.log(chalk.dim('  Cancelled.'));
      rl.prompt();
      return;
    }

    // Clear multiline state
    if (isMultiline) {
      multilineBuffer = [];
      isMultiline = false;
    }

    if (now - lastCtrlC < 1500) {
      exitGracefully();
    }

    lastCtrlC = now;
    console.log(chalk.dim('\n  Ctrl+C again to exit'));
    rl.prompt();
  });

  // Handle Ctrl+D / stream close
  // Only exit if the user explicitly closed (not if readline auto-closes after async)
  let userRequestedExit = false;
  rl.on('close', () => {
    if (!userRequestedExit) {
      // Readline closed unexpectedly (e.g., after async handler) - reopen
      // This happens in Node.js when async handlers are used with readline
      return;
    }
    saveHistory(history);
    console.log('');
    process.exit(0);
  });

  // Graceful exit helper
  const exitGracefully = () => {
    userRequestedExit = true;
    saveHistory(history);
    console.log('');
    rl.close();
    process.exit(0);
  };

  // Override exit command to use graceful exit
  const exitCmd = commands.find((c) => c.name === 'exit');
  if (exitCmd) {
    exitCmd.handler = () => exitGracefully();
  }

  // Handle input
  rl.on('line', async (line) => {
    let input: string;
    if (isMultiline) {
      multilineBuffer.push(line);
      input = multilineBuffer.join('\n').trim();
      multilineBuffer = [];
      isMultiline = false;
    } else {
      input = line.trim();
    }

    if (!input) {
      rl.prompt();
      return;
    }

    // Save to history
    history.push(input);

    // Handle slash commands
    if (input.startsWith('/')) {
      const [cmdName, ...args] = input.slice(1).split(/\s+/);
      const cmd = commands.find(
        (c) => c.name === cmdName.toLowerCase() || c.aliases.includes(cmdName.toLowerCase()),
      );

      if (cmd) {
        await cmd.handler(args, state);
      } else {
        render.error(`Unknown command: /${cmdName}. Type /help for commands.`);
      }

      updatePrompt();
      rl.prompt();
      return;
    }

    // Handle !command shortcut for shell
    if (input.startsWith('!')) {
      const shellCmd = input.slice(1).trim();
      if (shellCmd) {
        const runCmd = commands.find((c) => c.name === 'run');
        if (runCmd) await runCmd.handler(shellCmd.split(/\s+/), state);
      }
      rl.prompt();
      return;
    }

    // Send message
    lastUserMessage = input;
    const messageStartTime = Date.now();
    const response = await handleMessage(input, state, options, render, rl, history);
    if (response) {
      lastAssistantResponse = response;
      // Cache for /retry comparison
      state.lastResponseCache = {
        content: response,
        model: state.model || 'default',
        durationMs: Date.now() - messageStartTime,
      };
    }

    // Auto-generate session title after first message
    if (state.messageCount === 1 && state.session && !state.session.title) {
      autoTitleSession(state.serverUrl, state.session.conversationId, input).catch(() => {});
    }

    // Handle pending retry
    if (pendingRetry) {
      const retryMsg = pendingRetry;
      pendingRetry = '';
      lastUserMessage = retryMsg;
      const retryResponse = await handleMessage(retryMsg, state, options, render, rl, history);
      if (retryResponse) lastAssistantResponse = retryResponse;
    }

    updatePrompt();
    rl.prompt();
  });

  // Start
  updatePrompt();
  rl.prompt();
}

async function handleMessage(
  content: string,
  state: REPLState,
  options: InteractiveOptions,
  render: ReturnType<typeof createRenderer>,
  _rl: readline.Interface,
  chatHistory: string[],
): Promise<string> {
  let capturedResponse = '';
  // Ensure we have a session
  if (!state.session) {
    const result = await createConversation(options.server, {
      mode: 'agentic',
      presetId: 'agentic',
    });

    if ('error' in result) {
      render.error(result.error);
      return '';
    }

    state.session = {
      conversationId: result.conversationId,
      mode: state.agenticMode ? 'agentic' : 'chat',
      totalTokens: 0,
      totalCost: 0,
      messageCount: 0,
      createdAt: new Date(),
    };

    // Persist for auto-resume next time
    saveLastSession(result.conversationId);
  }

  // Display user message
  render.userMessage(content);
  state.messageCount++;

  // Start streaming
  const startTime = Date.now();
  state.isStreaming = true;
  state.streamStartTime = startTime;

  // Simple inline spinner (no ora - it fights readline in TTY)
  const frames = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
  let frameIdx = 0;
  let spinnerStopped = false;

  const spinnerInterval = setInterval(() => {
    if (!spinnerStopped) {
      const elapsed = formatElapsed(Date.now() - startTime);
      const frame = frames[frameIdx % frames.length];
      process.stdout.write(`\r${chalk.dim(`  ${frame} ${elapsed}`)}\x1b[K`);
      frameIdx++;
    }
  }, 80);
  activeSpinnerInterval = spinnerInterval;

  const stopSpinner = () => {
    if (!spinnerStopped) {
      spinnerStopped = true;
      clearInterval(spinnerInterval);
      process.stdout.write('\r\x1b[K'); // Clear the spinner line
    }
  };

  let assistantStarted = false;
  let currentThinking = false;

  try {
    const abortController = new AbortController();
    activeAbort = abortController;

    for await (const event of streamChat(options.server, {
      conversationId: state.session.conversationId,
      content,
      model: state.model,
      provider: state.provider,
      agentic: state.agenticMode,
      showThinking: state.showThinking,
      effort: state.effort,
      signal: abortController.signal,
    })) {
      if (!state.isStreaming) {
        abortController.abort();
        break;
      }

      switch (event.type) {
        case 'content_delta': {
          if (!assistantStarted) {
            stopSpinner();
            render.assistantStart(state.model);
            assistantStarted = true;
          }
          if (currentThinking) {
            render.thinkingEnd();
            currentThinking = false;
          }
          const chunk = event.data.content as string;
          if (chunk) {
            render.assistantDelta(chunk);
            capturedResponse += chunk;
          }
          break;
        }

        case 'thinking_start':
        case 'thinking:start': {
          if (!assistantStarted) {
            stopSpinner();
            render.assistantStart(state.model);
            assistantStarted = true;
          }
          if (state.showThinking) {
            render.thinkingStart();
            currentThinking = true;
          }
          break;
        }

        case 'thinking_update':
        case 'thinking:update': {
          if (state.showThinking && currentThinking) {
            const chunk = event.data.content as string;
            if (chunk) render.thinkingDelta(chunk);
          }
          break;
        }

        case 'thinking_end': {
          if (currentThinking) {
            render.thinkingEnd();
            currentThinking = false;
          }
          break;
        }

        case 'tool_call':
        case 'tool:call': {
          const toolName = event.data.name as string || event.data.toolName as string || 'unknown';
          const toolArgs = event.data.arguments as Record<string, unknown> || event.data.args as Record<string, unknown> || {};

          // Always show tool activity (minimal line, not gated on showTools)
          stopSpinner();
          if (!assistantStarted) {
            render.assistantStart(state.model);
            assistantStarted = true;
          }

          if (state.showTools) {
            // Verbose: show full tool call with args
            render.toolCall(toolName, toolArgs);
          } else {
            // Minimal: just show what's happening
            const firstArg = Object.values(toolArgs)[0];
            const preview = firstArg ? String(firstArg).slice(0, 50) : '';
            console.log(chalk.dim(`  ${chalk.cyan(toolName)} ${preview}`));
          }
          break;
        }

        case 'tool_result':
        case 'tool:result': {
          const resultName = event.data.name as string || event.data.toolName as string || 'unknown';
          const result = event.data.result || event.data.output;
          const success = event.data.success !== false;
          const durationMs = event.data.durationMs as number | undefined;

          if (state.showTools) {
            render.toolResult(resultName, result, success, durationMs);
          } else {
            // Minimal: just show ok/fail
            const icon = success ? chalk.hex('#7DD3A5')('\u2713') : chalk.hex('#F97066')('\u2717');
            const dur = durationMs ? chalk.dim(` ${formatElapsed(durationMs)}`) : '';
            console.log(chalk.dim(`  ${icon}${dur}`));
          }
          break;
        }

        case 'step_start':
        case 'step:start': {
          // Show step progress
          const stepNum = event.data.step as number;
          if (stepNum && stepNum > 1) {
            // Show step indicator for multi-step work
            process.stdout.write(chalk.dim(`  step ${stepNum}...\r`));
          }
          break;
        }

        case 'step_complete':
        case 'step:complete': {
          // Step done - spinner continues for next step
          break;
        }

        case 'thinking:end': {
          if (currentThinking) {
            render.thinkingEnd();
            currentThinking = false;
          }
          // In agentic mode, thinking:end.text contains the actual response
          const responseText = event.data.text as string;
          if (responseText) {
            stopSpinner();
            if (!assistantStarted) {
              render.assistantStart(state.model);
              assistantStarted = true;
            }
            // Typewriter effect: emit word-by-word for streaming feel
            const words = responseText.split(/(\s+)/);
            for (let wi = 0; wi < words.length; wi++) {
              render.assistantDelta(words[wi]);
              if (wi % 4 === 3 && wi < words.length - 1) {
                await new Promise((r) => setTimeout(r, 12));
              }
            }
            capturedResponse += responseText;
          }
          break;
        }

        case 'summary': {
          // Final summary - show if we haven't captured any response yet
          const summaryText = event.data.summary as string || event.data.content as string || event.data.text as string;
          if (summaryText && !capturedResponse) {
            stopSpinner();
            if (!assistantStarted) {
              render.assistantStart(state.model);
              assistantStarted = true;
            }
            render.assistantDelta(summaryText);
            capturedResponse += summaryText;
          }
          break;
        }

        case 'complete': {
          stopSpinner();
          if (assistantStarted) {
            render.assistantEnd();
          }

          // Display usage - data may contain usage directly or nested
          const rawUsage = event.data.usage as TokenUsage | undefined;
          const usage: TokenUsage | undefined = rawUsage || (event.data.totalTokens ? {
            promptTokens: (event.data.inputTokens as number) || 0,
            completionTokens: (event.data.outputTokens as number) || 0,
            totalTokens: (event.data.totalTokens as number) || 0,
            cost: event.data.cost as number | undefined,
          } : undefined);
          const durationMs = Date.now() - startTime;

          if (usage && state.showUsage) {
            render.usage(usage, durationMs);
            state.sessionTokens += usage.totalTokens || 0;
            state.sessionCost += usage.cost || 0;
          } else if (state.showUsage) {
            console.log(chalk.dim(`  ${formatElapsed(durationMs)}`));
          }

          // Session footer - running totals
          if (state.showUsage && state.messageCount > 0) {
            render.sessionFooter({
              sessionTokens: state.sessionTokens,
              sessionCost: state.sessionCost,
              messageCount: state.messageCount,
              model: state.model,
            });
          }
          break;
        }

        case 'error': {
          stopSpinner();
          const errMsg = event.data.message as string || 'Unknown error';

          // If streaming failed, fall back to non-streaming
          if (!assistantStarted && errMsg.includes('No output')) {
            const { sendMessage } = await import('./stream-client.js');
            const fallbackResult = await sendMessage(
              options.server,
              state.session!.conversationId,
              content,
              { model: state.model, tools: state.agenticMode },
            );
            if ('error' in fallbackResult) {
              render.error(fallbackResult.error);
            } else {
              render.assistantStart(fallbackResult.model);
              render.assistantDelta(fallbackResult.content);
              render.assistantEnd();
            }
            break;
          }

          render.error(errMsg);
          break;
        }

        case 'session_start':
        case 'user_message':
          // Acknowledgment events - no display needed
          break;

        default:
          // Unknown event type - skip
          break;
      }
    }
  } catch (error) {
    stopSpinner();
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(chalk.dim('\n  Cancelled.'));
    } else {
      render.error(error instanceof Error ? error.message : 'Stream failed');
    }
  } finally {
    stopSpinner(); // Always stop spinner before clearing interval to avoid leaked frame writes
    clearInterval(spinnerInterval);
    activeSpinnerInterval = null;
    activeAbort = null;
    state.isStreaming = false;
    state.streamStartTime = undefined;

    // Ensure we end properly
    if (assistantStarted && !state.isStreaming) {
      // assistantEnd was called in 'complete' handler
    }

    // Save history periodically
    if (state.messageCount % 5 === 0) {
      saveHistory(chatHistory);
    }
  }

  return capturedResponse;
}
