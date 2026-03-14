/**
 * Tools CLI Commands
 *
 * Test and manage built-in execution tools from the command line.
 * Allows direct tool execution without needing the API server.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createTable, error, info, spinner, success } from '../utils/output.js';
import { registerBuiltinTools } from '../../chat/execution/tools/index.js';
import { getToolRegistry } from '../../chat/execution/registry.js';
import type {
  ToolExecutionContext,
  ToolDefinition,
  SecurityPolicy,
  SessionManager,
  ToolSession,
  SessionFilter,
} from '../../chat/execution/types.js';
import type { ExecResult } from '../../chat/execution/tools/exec.js';
import type { ReadFileResult, SearchFilesResult, GrepResult, GrepMatch } from '../../chat/execution/tools/file-ops.js';

// Lazy initialization - only register tools when a tools command actually runs
let toolsInitialized = false;
function getRegistry(): ReturnType<typeof getToolRegistry> {
  if (!toolsInitialized) {
    registerBuiltinTools();
    toolsInitialized = true;
  }
  return getToolRegistry();
}

// Minimal Session Manager for CLI

class CLISessionManager implements SessionManager {
  private sessions = new Map<string, ToolSession>();
  private counter = 0;

  create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
    const id = `cli-session-${++this.counter}`;
    const fullSession: ToolSession = {
      ...session,
      id,
      createdAt: Date.now(),
    };
    this.sessions.set(id, fullSession);
    return fullSession;
  }

  get(sessionId: string): ToolSession | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, update: Partial<ToolSession>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, update);
    }
  }

  list(filter?: SessionFilter): ToolSession[] {
    let sessions = Array.from(this.sessions.values());
    if (filter?.toolName) {
      sessions = sessions.filter(s => s.toolName === filter.toolName);
    }
    if (filter?.status) {
      sessions = sessions.filter(s => filter.status!.includes(s.status));
    }
    return sessions;
  }

  async kill(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'killed';
    }
  }

  cleanup(): void {
    this.sessions.clear();
  }
}

// Context Creation

const cliSessionManager = new CLISessionManager();

/**
 * Create execution context for CLI
 */
function createContext(workdir?: string): ToolExecutionContext {
  const defaultPolicy: SecurityPolicy = {
    mode: 'full',
    askTimeout: 30000,
  };

  return {
    toolCallId: `cli-call-${Date.now()}`,
    conversationId: `cli-${Date.now()}`,
    userId: 'cli-user',
    workdir: workdir || process.cwd(),
    env: process.env as Record<string, string>,
    securityPolicy: defaultPolicy,
    sessionManager: cliSessionManager,
  };
}

// CLI Commands

export function toolsCommands() {
  const tools = new Command('tools')
    .description('Test and manage execution tools');

  // List all tools
  tools
    .command('list')
    .alias('ls')
    .description('List all available tools')
    .option('--json', 'Output as JSON')
    .option('-c, --category <cat>', 'Filter by category')
    .action(async (options) => {
      const registry = getRegistry();
      let toolList: ToolDefinition[] = registry.list();

      if (options.category) {
        toolList = toolList.filter((t: ToolDefinition) => t.category === options.category);
      }

      if (options.json) {
        const data = toolList.map((t: ToolDefinition) => ({
          name: t.name,
          description: t.description,
          category: t.category,
          securityLevel: t.securityLevel,
          requiresApproval: t.requiresApproval || false,
        }));
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(`\n${chalk.bold('Available Tools')} (${toolList.length} total)\n`);

      // Group by category
      const byCategory = new Map<string, ToolDefinition[]>();
      for (const tool of toolList) {
        const cat = tool.category || 'other';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(tool);
      }

      for (const [category, categoryTools] of byCategory) {
        console.log(chalk.cyan.bold(`  ${category.toUpperCase()}`));

        const table = createTable(['Name', 'Security', 'Description']);

        for (const tool of categoryTools) {
          const securityColors: Record<string, (s: string) => string> = {
            safe: chalk.green,
            moderate: chalk.yellow,
            dangerous: chalk.red,
          };
          const level = tool.securityLevel || 'safe';
          const securityColor = securityColors[level] || chalk.white;

          table.push([
            tool.name,
            securityColor(level),
            tool.description.slice(0, 50) + (tool.description.length > 50 ? '...' : ''),
          ]);
        }

        console.log(table.toString());
        console.log('');
      }
    });

  // Show tool details
  tools
    .command('info <name>')
    .description('Show detailed information about a tool')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options) => {
      const registry = getRegistry();
      const tool = registry.get(name);

      if (!tool) {
        error(`Tool '${name}' not found`);
        console.log(chalk.dim('\nAvailable tools:'));
        const names = registry.list().map((t: ToolDefinition) => t.name);
        console.log(chalk.dim('  ' + names.join(', ')));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({
          name: tool.name,
          description: tool.description,
          category: tool.category,
          securityLevel: tool.securityLevel,
          requiresApproval: tool.requiresApproval || false,
          allowedHosts: tool.allowedHosts,
          examples: tool.examples,
        }, null, 2));
        return;
      }

      console.log(`\n${chalk.bold.cyan(tool.name)}`);
      console.log(chalk.dim('─'.repeat(40)));
      console.log(`\n${tool.description}\n`);

      console.log(chalk.bold('Properties:'));
      console.log(`  Category:        ${tool.category}`);
      console.log(`  Security Level:  ${tool.securityLevel || 'safe'}`);
      console.log(`  Requires Approval: ${tool.requiresApproval ? chalk.yellow('Yes') : chalk.green('No')}`);
      console.log(`  Allowed Hosts:   ${tool.allowedHosts?.join(', ') || 'all'}`);

      if (tool.examples && tool.examples.length > 0) {
        console.log(`\n${chalk.bold('Examples:')}`);
        for (const ex of tool.examples) {
          console.log(`\n  ${chalk.cyan(ex.description)}`);
          console.log(`  ${chalk.dim('Params:')} ${JSON.stringify(ex.params)}`);
        }
      }

      console.log('');
    });

  // Execute a tool
  tools
    .command('exec <name>')
    .description('Execute a tool with parameters')
    .option('-p, --params <json>', 'Parameters as JSON string')
    .option('-w, --workdir <path>', 'Working directory', process.cwd())
    .option('--json', 'Output result as JSON')
    .option('-y, --yes', 'Skip approval for moderate tools')
    .action(async (name: string, options) => {
      const registry = getRegistry();
      const tool = registry.get(name);

      if (!tool) {
        error(`Tool '${name}' not found`);
        process.exit(1);
      }

      // Parse parameters
      let params = {};
      if (options.params) {
        try {
          params = JSON.parse(options.params);
        } catch {
          error('Invalid JSON for --params');
          process.exit(1);
        }
      }

      // Check approval requirement
      if (tool.requiresApproval && !options.yes) {
        console.log(chalk.yellow(`\n⚠ Tool '${name}' requires approval (security: ${tool.securityLevel})`));
        console.log(chalk.dim('  Use -y/--yes to skip this prompt'));
        console.log(chalk.dim('  Params: ' + JSON.stringify(params)));

        // Simple confirmation in CLI
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(chalk.yellow('\nProceed? (y/N): '), resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          info('Execution cancelled');
          process.exit(0);
        }
      }

      // Execute
      const spin = spinner(`Executing ${name}...`).start();
      const context = createContext(options.workdir);

      try {
        const result = await tool.execute(context, params);
        spin.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.success) {
          success(`Tool '${name}' executed successfully`);
          if (result.output) {
            console.log(chalk.dim('\n--- Output ---'));
            console.log(result.output);
          }
        } else {
          error(`Tool '${name}' failed: ${result.error?.message || 'Unknown error'}`);
          if (result.error?.code) {
            console.log(chalk.dim(`  Code: ${result.error.code}`));
          }
          process.exit(1);
        }
      } catch (err) {
        spin.stop();
        error(`Execution error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // Quick shortcuts for common tools

  // exec shortcut
  tools
    .command('run <command...>')
    .description('Shortcut: Execute a shell command')
    .option('-w, --workdir <path>', 'Working directory')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '30000')
    .option('--json', 'Output as JSON')
    .action(async (commandParts: string[], options) => {
      const command = commandParts.join(' ');
      const registry = getRegistry();
      const tool = registry.get('exec');

      if (!tool) {
        error('exec tool not found');
        process.exit(1);
      }

      console.log(chalk.dim(`$ ${command}\n`));

      const context = createContext(options.workdir);
      const params = {
        command,
        timeout: parseInt(options.timeout, 10),
      };

      try {
        const result = await tool.execute(context, params);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.output) {
          console.log(result.output);
        }

        if (!result.success) {
          const execResult = result.data as ExecResult | undefined;
          process.exit(execResult?.exitCode ?? 1);
        }
      } catch (err) {
        error(`${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // git status shortcut
  tools
    .command('git-status')
    .description('Shortcut: Show git status')
    .option('-s, --short', 'Short format')
    .option('-w, --workdir <path>', 'Repository path')
    .action(async (options) => {
      const registry = getRegistry();
      const tool = registry.get('git_status');

      if (!tool) {
        error('git_status tool not found');
        process.exit(1);
      }

      const context = createContext(options.workdir);
      const params = { short: options.short };

      const result = await tool.execute(context, params);

      if (result.success) {
        console.log(result.output);
      } else {
        error(result.error?.message || 'Git status failed');
        process.exit(1);
      }
    });

  // system info shortcut
  tools
    .command('sysinfo')
    .description('Shortcut: Show system information')
    .option('-t, --type <type>', 'Info type: all, cpu, memory, os, network', 'all')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const registry = getRegistry();
      const tool = registry.get('system_info');

      if (!tool) {
        error('system_info tool not found');
        process.exit(1);
      }

      const context = createContext();
      const params = { type: options.type };

      const result = await tool.execute(context, params);

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      if (result.success) {
        console.log(result.output);
      } else {
        error(result.error?.message || 'System info failed');
        process.exit(1);
      }
    });

  // env shortcut
  tools
    .command('env [name]')
    .description('Shortcut: Show environment variables')
    .option('-f, --filter <pattern>', 'Filter by pattern')
    .action(async (name: string | undefined, options) => {
      const registry = getRegistry();
      const tool = registry.get('env');

      if (!tool) {
        error('env tool not found');
        process.exit(1);
      }

      const context = createContext();
      const params = { name, filter: options.filter };

      const result = await tool.execute(context, params);

      if (result.success) {
        console.log(result.output);
      } else {
        error(result.error?.message || 'Env check failed');
        process.exit(1);
      }
    });

  // which shortcut
  tools
    .command('which <command>')
    .description('Shortcut: Find command location')
    .action(async (command: string) => {
      const registry = getRegistry();
      const tool = registry.get('which');

      if (!tool) {
        error('which tool not found');
        process.exit(1);
      }

      const context = createContext();
      const result = await tool.execute(context, { command });

      if (result.success) {
        console.log(result.output);
      } else {
        error(`Command '${command}' not found in PATH`);
        process.exit(1);
      }
    });

  // read file shortcut
  tools
    .command('read <path>')
    .description('Shortcut: Read a file')
    .option('-l, --lines <n>', 'Max lines to read', '100')
    .action(async (filePath: string, options) => {
      const registry = getRegistry();
      const tool = registry.get('read_file');

      if (!tool) {
        error('read_file tool not found');
        process.exit(1);
      }

      const context = createContext();
      const params = {
        path: filePath,
        maxLines: parseInt(options.lines, 10),
      };

      const result = await tool.execute(context, params);

      if (result.success) {
        const readResult = result.data as ReadFileResult | undefined;
        console.log(readResult?.content || result.output);
      } else {
        error(result.error?.message || 'Read failed');
        process.exit(1);
      }
    });

  // search files shortcut
  tools
    .command('find <pattern>')
    .description('Shortcut: Search for files')
    .option('-p, --path <dir>', 'Search directory', '.')
    .option('-t, --type <type>', 'File type: file, directory, both', 'file')
    .action(async (pattern: string, options) => {
      const registry = getRegistry();
      const tool = registry.get('search_files');

      if (!tool) {
        error('search_files tool not found');
        process.exit(1);
      }

      const context = createContext();
      const params = {
        pattern,
        path: options.path,
        type: options.type,
      };

      const spin = spinner('Searching...').start();
      const result = await tool.execute(context, params);
      spin.stop();

      if (result.success) {
        const searchResult = result.data as SearchFilesResult | undefined;
        const files = searchResult?.files || [];
        if (files.length === 0) {
          info('No files found');
        } else {
          console.log(files.join('\n'));
          console.log(chalk.dim(`\n${files.length} file(s) found`));
        }
      } else {
        error(result.error?.message || 'Search failed');
        process.exit(1);
      }
    });

  // grep shortcut
  tools
    .command('grep <pattern> [path]')
    .description('Shortcut: Search file contents')
    .option('-i, --ignore-case', 'Case insensitive')
    .option('-c, --context <n>', 'Context lines', '0')
    .action(async (pattern: string, searchPath: string | undefined, options) => {
      const registry = getRegistry();
      const tool = registry.get('grep');

      if (!tool) {
        error('grep tool not found');
        process.exit(1);
      }

      const context = createContext();
      const params = {
        pattern,
        path: searchPath || '.',
        ignoreCase: options.ignoreCase,
        contextLines: parseInt(options.context, 10),
      };

      const spin = spinner('Searching...').start();
      const result = await tool.execute(context, params);
      spin.stop();

      if (result.success) {
        const grepResult = result.data as GrepResult | undefined;
        const matches = grepResult?.matches || [];
        if (matches.length === 0) {
          info('No matches found');
        } else {
          for (const match of matches as GrepMatch[]) {
            console.log(`${chalk.cyan(match.file)}:${chalk.yellow(String(match.line))}: ${match.content}`);
          }
          console.log(chalk.dim(`\n${matches.length} match(es) found`));
        }
      } else {
        error(result.error?.message || 'Search failed');
        process.exit(1);
      }
    });

  return tools;
}
