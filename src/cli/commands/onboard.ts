/**
 * CLI Onboard Command
 *
 * Zero-to-running in one command. Detects environment, recommends deployment mode,
 * generates .env, runs setup wizard, starts server.
 *
 * Usage:
 *   profclaw onboard                                    # Interactive
 *   profclaw onboard --non-interactive --mode mini      # CI/Docker
 */

import { Command } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import { select, search, input, confirm, Separator } from '@inquirer/prompts';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { success, error, info, warn, spinner } from '../utils/output.js';
import { PROVIDER_CATALOG, PROVIDER_ENV_KEYS } from '../providers.js';
import type { DeploymentMode } from '../../core/deployment.js';

/** Returns true if an env var name should have its value masked. */
function isSensitiveKey(key: string): boolean {
  return key.includes('KEY') || key.includes('TOKEN') || key.includes('SECRET');
}

/** Mask an API key for display — shows first 8 chars and last 4, dots in between. */
function maskApiKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + '•'.repeat(key.length - 4);
  return key.slice(0, 8) + '•'.repeat(8) + key.slice(-4);
}

/** Format a generated env file for display with sensitive values masked. */
function formatEnvPreview(content: string): string {
  return content.split('\n')
    .map(line => {
      if (line.startsWith('#') || line.trim() === '') return chalk.dim(`  ${line}`);
      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) return chalk.dim(`  ${line}`);
      const key = line.slice(0, eqIndex);
      const value = line.slice(eqIndex + 1);
      if (isSensitiveKey(key)) {
        return `  ${chalk.cyan(key)}=${chalk.yellow(maskApiKey(value))}`;
      }
      return `  ${chalk.cyan(key)}=${chalk.white(value)}`;
    })
    .join('\n');
}

/** Render a step header with progress bar. */
function stepHeader(step: number, total: number, title: string): void {
  const barLen = 20;
  const filled = Math.round((step / total) * barLen);
  const bar = chalk.cyan('━'.repeat(filled)) + chalk.dim('━'.repeat(barLen - filled));
  console.log(`\n  ${bar}  ${chalk.dim(`${step}/${total}`)}  ${chalk.bold.white(title)}\n`);
}

// Environment Detection

interface EnvironmentInfo {
  os: string;
  arch: string;
  nodeVersion: string;
  totalMemoryMb: number;
  isDocker: boolean;
  hasRedis: boolean;
  hasOllama: boolean;
  hasClaude: boolean;
  hasGit: boolean;
  existingEnv: boolean;
  existingDb: boolean;
}

const DETECT_TIMEOUT_MS = 5000;

/** Wrap a detection check with a timeout so a hung service doesn't block onboarding. */
async function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs = DETECT_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function detectRedis(): Promise<boolean> {
  try {
    const IORedis = (await import('ioredis')).default;
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redis.connect();
    await redis.ping();
    await redis.disconnect();
    return true;
  } catch {
    return false;
  }
}

async function detectOllama(): Promise<boolean> {
  try {
    const url = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function detectBinary(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function detectEnvironment(): Promise<EnvironmentInfo> {
  const os = await import('node:os');

  const isDocker = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
  const totalMemoryMb = Math.round(os.totalmem() / (1024 * 1024));

  // Run network checks in parallel with timeouts
  const [hasRedis, hasOllama] = await Promise.all([
    withTimeout(detectRedis(), false),
    withTimeout(detectOllama(), false),
  ]);

  // Binary checks are fast, no timeout needed
  const hasClaude = detectBinary('claude');
  const hasGit = detectBinary('git');

  return {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    totalMemoryMb,
    isDocker,
    hasRedis,
    hasOllama,
    hasClaude,
    hasGit,
    existingEnv: existsSync(join(process.cwd(), '.env')),
    existingDb: existsSync(join(process.cwd(), 'data', 'profclaw.db')),
  };
}

function recommendMode(env: EnvironmentInfo): DeploymentMode {
  // Low memory or no Redis: pico
  if (env.totalMemoryMb < 512) return 'pico';

  // Has Redis and plenty of RAM: pro
  if (env.hasRedis && env.totalMemoryMb >= 2048) return 'pro';

  // Default: mini
  return 'mini';
}

// .env Generation

function generateEnvFile(opts: {
  mode: DeploymentMode;
  anthropicKey?: string;
  openaiKey?: string;
  ollamaUrl?: string;
  extraEnvVars?: Record<string, string>;
  port?: string;
}): string {
  const lines: string[] = [
    '# profClaw Configuration',
    `# Generated by: profclaw onboard`,
    `# Date: ${new Date().toISOString()}`,
    '',
    '# Deployment Mode',
    `PROFCLAW_MODE=${opts.mode}`,
    '',
    `PORT=${opts.port || '3000'}`,
    '',
  ];

  if (opts.anthropicKey) {
    lines.push('# AI Provider');
    lines.push(`ANTHROPIC_API_KEY=${opts.anthropicKey}`);
    lines.push('');
  } else if (opts.openaiKey) {
    lines.push('# AI Provider');
    lines.push(`OPENAI_API_KEY=${opts.openaiKey}`);
    lines.push('');
  } else if (opts.ollamaUrl) {
    lines.push('# AI Provider (Ollama - free local AI)');
    lines.push(`OLLAMA_BASE_URL=${opts.ollamaUrl}`);
    lines.push('');
  }

  // Write any extra env vars from selected providers
  if (opts.extraEnvVars) {
    for (const [key, value] of Object.entries(opts.extraEnvVars)) {
      lines.push(`${key}=${value}`);
    }
    if (Object.keys(opts.extraEnvVars).length > 0) lines.push('');
  }

  if (opts.mode === 'pro') {
    lines.push('# Redis (required for pro mode)');
    lines.push('REDIS_URL=redis://localhost:6379');
    lines.push('');
  }

  return lines.join('\n');
}

// API Key Validation

interface ValidationResult {
  valid: boolean;
  error?: string;
}

const KEY_FORMAT_PREFIXES: Readonly<Record<string, string>> = {
  anthropic: 'sk-ant-',
  openai: 'sk-',
  groq: 'gsk_',
};

async function validateProviderKey(providerKey: string, apiKey: string): Promise<ValidationResult> {
  // Fast-fail: format check for known prefix patterns
  const expectedPrefix = KEY_FORMAT_PREFIXES[providerKey];
  if (expectedPrefix && !apiKey.startsWith(expectedPrefix)) {
    return {
      valid: false,
      error: `Key should start with "${expectedPrefix}"`,
    };
  }

  // Ollama uses a local URL, no key validation needed
  if (providerKey === 'ollama') {
    return { valid: true };
  }

  // Lightweight API call to verify the key works
  try {
    let response: Response;

    if (providerKey === 'anthropic') {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
    } else if (providerKey === 'openai') {
      response = await fetch('https://api.openai.com/v1/models', {
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } else if (providerKey === 'google') {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(5000) },
      );
    } else if (providerKey === 'groq') {
      response = await fetch('https://api.groq.com/openai/v1/models', {
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } else {
      // Provider not supported for live validation — skip
      return { valid: true };
    }

    if (response.ok) {
      return { valid: true };
    }

    // Parse error message from response body when possible
    let detail: string | undefined;
    try {
      const body = (await response.json()) as { error?: { message?: string }; message?: string };
      detail = body?.error?.message ?? (typeof body?.message === 'string' ? body.message : undefined);
    } catch {
      // ignore parse failure
    }

    return {
      valid: false,
      error: detail ?? `HTTP ${response.status}`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { valid: false, error: 'Request timed out (5s)' };
    }
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

// Interactive Onboarding

async function runInteractive(): Promise<void> {
  const banner = figlet.textSync('profClaw', { font: 'Standard' });
  console.log(chalk.cyan(banner));
  console.log(chalk.dim('  Onboarding Wizard\n'));

  // Step 1: Detect environment
  stepHeader(1, 6, 'Environment Detection');
  const spin = spinner('Scanning environment...');
  spin.start();
  const env = await detectEnvironment();
  spin.stop();

  // Helpers for display
  const ok = (label: string, value: string) =>
    console.log(`  ${chalk.green('+')} ${chalk.white(label.padEnd(14))} ${value}`);
  const no = (label: string, value: string, hint?: string) => {
    console.log(`  ${chalk.yellow('~')} ${chalk.dim(label.padEnd(14))} ${chalk.dim(value)}`);
    if (hint) console.log(`    ${chalk.dim('\u2514')} ${chalk.yellow(hint)}`);
  };

  const ramGb = (env.totalMemoryMb / 1024).toFixed(0);
  const ramBar = (() => {
    const total = 16; // bar width
    const filled = Math.min(total, Math.round((env.totalMemoryMb / 65536) * total));
    return chalk.green('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(total - filled));
  })();
  const ramWarn = env.totalMemoryMb < 512
    ? chalk.red(' (low - pico mode recommended)')
    : env.totalMemoryMb < 2048
      ? chalk.yellow(' (limited - mini mode recommended)')
      : '';

  // -- System --
  console.log('');
  console.log(`  ${chalk.bold.cyan('System')}`);
  ok('OS', `${env.os} (${env.arch})`);
  ok('Node', env.nodeVersion);
  ok('RAM', `${ramGb} GB ${ramBar}${ramWarn}`);
  if (env.isDocker) {
    ok('Docker', 'Running in container');
  }

  // -- Services --
  console.log('');
  console.log(`  ${chalk.bold.cyan('Services')}`);
  if (env.hasRedis) {
    ok('Redis', chalk.green('connected'));
  } else {
    no('Redis', 'not found (optional)',
      'Install: brew install redis  |  docker run -d -p 6379:6379 redis:alpine');
  }
  if (env.hasOllama) {
    ok('Ollama', chalk.green('running') + ' (free local AI)');
  } else {
    no('Ollama', 'not running (optional)',
      'Install: brew install ollama && ollama serve  |  https://ollama.com/download');
  }

  // -- Tools --
  console.log('');
  console.log(`  ${chalk.bold.cyan('Tools')}`);
  if (env.hasClaude) {
    ok('Claude CLI', 'found');
  } else {
    no('Claude CLI', 'not found (optional)',
      'Install: npm install -g @anthropic-ai/claude-code');
  }
  if (env.hasGit) {
    ok('Git', 'found');
  } else {
    no('Git', 'not found',
      'Install: brew install git  |  https://git-scm.com/downloads');
  }

  // -- Existing Data --
  if (env.existingEnv || env.existingDb) {
    console.log('');
    console.log(`  ${chalk.bold.cyan('Existing Data')}`);
    if (env.existingEnv) ok('.env', 'found');
    if (env.existingDb) ok('Database', 'found');
  }

  const recommended = recommendMode(env);
  console.log('');
  console.log(`  ${chalk.cyan('Recommended mode:')} ${chalk.bold(recommended)}`);

  // Step 2: Choose mode
  stepHeader(2, 6, 'Deployment Mode');

  let mode: DeploymentMode;
  try {
    mode = await select<DeploymentMode>({
      message: 'Select deployment mode',
      default: recommended,
      choices: [
        {
          name: `Pico  - Agent + tools only, ~50MB RAM${recommended === 'pico' ? chalk.green(' (recommended)') : ''}`,
          value: 'pico' as const,
          description: 'Minimal footprint. CLI agent, tool execution, no web UI.',
        },
        {
          name: `Mini  - Dashboard, cron, integrations, ~150MB RAM${recommended === 'mini' ? chalk.green(' (recommended)') : ''}`,
          value: 'mini' as const,
          description: 'Web dashboard, scheduled jobs, GitHub/Jira/Linear webhooks.',
        },
        {
          name: `Pro   - Everything, Redis required, ~300MB RAM${recommended === 'pro' ? chalk.green(' (recommended)') : ''}`,
          value: 'pro' as const,
          description: 'BullMQ queues, plugins, sync engine, multi-agent orchestration.',
        },
      ],
      theme: { prefix: '  ', style: { highlight: (text: string) => chalk.cyan.bold(text) } },
    });
  } catch {
    console.log(chalk.dim('\n  Cancelled.'));
    process.exit(0);
  }
  success(`Mode: ${mode}`);

  // Step 3: AI Provider
  stepHeader(3, 6, 'AI Provider');
  let anthropicKey: string | undefined;
  let openaiKey: string | undefined;
  let ollamaUrl: string | undefined;

  // Check all provider env vars (not just Anthropic/OpenAI)
  let detectedProviderName: string | null = null;
  for (const p of PROVIDER_CATALOG) {
    const val = process.env[p.envVar];
    if (val && val !== '' && !val.startsWith('sk-ant-xxxx') && !val.startsWith('sk-xxxx')) {
      detectedProviderName = p.name;
      break;
    }
  }

  if (detectedProviderName) {
    info(`AI provider already configured from environment (${detectedProviderName}).`);
  } else {
    const providers = PROVIDER_CATALOG;

    // Check which providers have keys in env
    const detected = new Set<string>();
    for (const p of providers) {
      if (process.env[p.envVar]) detected.add(p.key);
    }
    if (env.hasOllama) detected.add('ollama');

    // Build searchable choices grouped by category
    let chosenProvider: string;

    try {
      chosenProvider = await search<string>({
        message: 'Select AI provider (type to filter, arrows to navigate)',
        pageSize: 15,
        source: (term: string | undefined) => {
          const results: Array<Separator | { name: string; value: string; description: string; short: string }> = [];
          const filter = (term || '').toLowerCase();
          let lastCategory = '';

          for (const p of providers) {
            // Filter by name, key, models, category, or tag
            if (filter && ![p.name, p.key, p.models, p.category, p.tag]
              .some(s => s.toLowerCase().includes(filter))) {
              continue;
            }

            // Add category separator
            if (p.category !== lastCategory) {
              if (results.length > 0) results.push(new Separator());
              results.push(new Separator(chalk.bold.cyan(` ${p.category} `)));
              lastCategory = p.category;
            }

            const det = detected.has(p.key) ? chalk.green(' *') : '';
            const tag = p.tag ? ` ${chalk.dim(`[${p.tag}]`)}` : '';
            results.push({
              name: `${p.name.padEnd(16)} ${chalk.dim(p.models)}${tag}${det}`,
              value: p.key,
              description: `${p.envVar}`,
              short: p.name,
            });
          }

          // Always add skip option at the end
          if (!filter || 'skip'.includes(filter)) {
            results.push(new Separator());
            results.push({
              name: chalk.dim('Skip for now'),
              value: 'skip',
              description: 'Configure later with: profclaw provider',
              short: 'Skip',
            });
          }

          return results;
        },
        theme: { prefix: '  ', style: { highlight: (text: string) => chalk.cyan.bold(text) } },
      });
    } catch {
      console.log(chalk.dim('\n  Cancelled.'));
      process.exit(0);
    }

    if (chosenProvider !== 'skip') {
      const chosen = providers.find(p => p.key === chosenProvider)!;
      console.log(`\n  ${chalk.bold(chosen.name)} selected`);
      console.log(chalk.dim(`  Env var: ${chosen.envVar}`));

      if (chosen.key === 'ollama') {
        if (env.hasOllama) {
          ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        } else {
          try {
            ollamaUrl = await input({
              message: 'Ollama URL',
              default: 'http://localhost:11434',
              theme: { prefix: '  ' },
            });
          } catch {
            ollamaUrl = 'http://localhost:11434';
          }
        }
        success(`Ollama: ${ollamaUrl}`);
      } else if (detected.has(chosen.key)) {
        success(`${chosen.name} already configured from ${chosen.envVar}`);
      } else {
        let configured = false;
        while (!configured) {
          let keyInput: string;
          try {
            keyInput = await input({
              message: chosen.envVar,
              theme: { prefix: '  ' },
            });
          } catch {
            warn('Input cancelled, skipping provider.');
            break;
          }

          if (!keyInput) {
            warn('No key provided, skipping.');
            break;
          }

          const verifySpin = spinner('Verifying API key...');
          verifySpin.start();
          const validation = await validateProviderKey(chosen.key, keyInput);
          verifySpin.stop();

          if (validation.valid) {
            if (chosen.key === 'anthropic') anthropicKey = keyInput;
            else if (chosen.key === 'openai') openaiKey = keyInput;
            else process.env[chosen.envVar] = keyInput;
            success(`${chosen.name} configured.`);
            configured = true;
          } else {
            error(`Invalid key: ${validation.error ?? 'verification failed'}`);
            let retry = false;
            try {
              retry = await confirm({
                message: 'Re-enter the key?',
                default: true,
                theme: { prefix: '  ' },
              });
            } catch {
              // cancelled
            }
            if (!retry) {
              warn(`Skipping ${chosen.name}.`);
              break;
            }
          }
        }
      }
    } else {
      info('AI provider skipped. Configure later: profclaw provider');
    }
  }

  // Collect extra env vars that were set during provider selection
  const extraEnvVars: Record<string, string> = {};
  if (!anthropicKey && !openaiKey && !ollamaUrl) {
    for (const key of PROVIDER_ENV_KEYS) {
      if (process.env[key]) extraEnvVars[key] = process.env[key]!;
    }
  }

  // Step 4: Generate .env
  stepHeader(4, 6, 'Configuration');

  const envPath = join(process.cwd(), '.env');

  if (!env.existingEnv) {
    const envContent = generateEnvFile({
      mode,
      anthropicKey,
      openaiKey,
      ollamaUrl,
      extraEnvVars,
    });

    console.log(chalk.bold.white('\n  Configuration Preview:\n'));
    console.log(formatEnvPreview(envContent));
    console.log('');

    let writeConfirmed = true;
    try {
      writeConfirmed = await confirm({
        message: 'Write this configuration to .env?',
        default: true,
        theme: { prefix: '  ' },
      });
    } catch { /* Ctrl+C — keep default true */ }

    if (!writeConfirmed) {
      warn('Skipped .env write. You can create it manually.');
    } else {
      try {
        writeFileSync(envPath, envContent, { mode: 0o600 });
        success('.env file created.');
      } catch (err) {
        error(`Failed to write .env: ${err instanceof Error ? err.message : 'unknown'}`);
        info('Create .env manually with the values above.');
      }
    }
  } else {
    let content = readFileSync(envPath, 'utf-8');

    // Update mode
    if (content.includes('PROFCLAW_MODE=')) {
      content = content.replace(/PROFCLAW_MODE=\w+/, `PROFCLAW_MODE=${mode}`);
    } else {
      content += `\nPROFCLAW_MODE=${mode}\n`;
    }

    // Add provider keys to existing .env
    const keysToWrite: Record<string, string> = { ...extraEnvVars };
    if (anthropicKey) keysToWrite['ANTHROPIC_API_KEY'] = anthropicKey;
    if (openaiKey) keysToWrite['OPENAI_API_KEY'] = openaiKey;
    if (ollamaUrl) keysToWrite['OLLAMA_BASE_URL'] = ollamaUrl;

    // Show preview of what will change
    const allUpdates: Record<string, string> = { PROFCLAW_MODE: mode, ...keysToWrite };
    console.log(chalk.bold.white('\n  Changes to existing .env:\n'));
    for (const [key, value] of Object.entries(allUpdates)) {
      const masked = isSensitiveKey(key) ? maskApiKey(value) : value;
      const action = content.includes(`${key}=`) ? chalk.yellow('update') : chalk.green('add');
      console.log(`  [${action}] ${chalk.cyan(key)}=${chalk.white(masked)}`);
    }
    console.log('');

    let writeConfirmed = true;
    try {
      writeConfirmed = await confirm({
        message: 'Apply these changes to .env?',
        default: true,
        theme: { prefix: '  ' },
      });
    } catch { /* Ctrl+C — keep default true */ }

    if (!writeConfirmed) {
      warn('Skipped .env update. You can edit it manually.');
    } else {
      for (const [key, value] of Object.entries(keysToWrite)) {
        if (content.includes(`${key}=`)) {
          content = content.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
        } else {
          content += `${key}=${value}\n`;
        }
      }

      writeFileSync(envPath, content);
      const keyCount = Object.keys(keysToWrite).length;
      if (keyCount > 0) {
        success(`PROFCLAW_MODE=${mode} + ${keyCount} provider key(s) saved to .env`);
      } else {
        success(`PROFCLAW_MODE=${mode} set in .env`);
      }
    }
  }

  // Steps 5-6: Delegate to setup wizard for admin account + registration
  // Setup continues the step numbering (5/6, 6/6) and shows summary + server start
  try {
    const { setupCommand } = await import('./setup.js');
    const setupCmd = setupCommand();
    await setupCmd.parseAsync(['node', 'setup', '--from-onboard']);
  } catch (err) {
    error(`Setup wizard failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    info('You can run it again later: profclaw setup');
  }
}

// Non-Interactive Onboarding

async function runNonInteractive(options: {
  mode?: string;
  provider?: string;
  port?: string;
}): Promise<void> {
  console.log(chalk.dim('  Running onboard in non-interactive mode...\n'));

  const spin = spinner('Detecting environment...');
  spin.start();
  const env = await detectEnvironment();
  spin.stop();

  const mode = (options.mode || recommendMode(env)) as DeploymentMode;
  success(`Mode: ${mode}`);

  // Generate .env if it doesn't exist
  if (!env.existingEnv) {
    try {
      const envPath = join(process.cwd(), '.env');
      const envContent = generateEnvFile({ mode, port: options.port });
      writeFileSync(envPath, envContent, { mode: 0o600 }); // Restrict permissions
      success('.env created');
    } catch (err) {
      error(`Failed to write .env: ${err instanceof Error ? err.message : 'permission denied'}`);
      info('Create .env manually with PROFCLAW_MODE=' + mode);
    }
  }

  // Delegate to setup --non-interactive
  try {
    const { setupCommand } = await import('./setup.js');
    const setupCmd = setupCommand();
    const args = ['node', 'setup', '--non-interactive'];
    if (options.provider) args.push('--ai-provider', options.provider);
    await setupCmd.parseAsync(args);
  } catch (err) {
    error(`Setup failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    info('Run setup manually: profclaw setup');
  }

  success('Non-interactive onboarding complete.');
}

// Command Registration

export function onboardCommand(): Command {
  const cmd = new Command('onboard')
    .description('Zero-to-running onboarding wizard (environment detection + setup + start)')
    .option('--non-interactive', 'Run without prompts')
    .option('--mode <mode>', 'Deployment mode: pico, mini, pro')
    .option('--provider <provider>', 'AI provider: anthropic, openai, ollama')
    .option('--port <port>', 'Server port (default: 3000)')
    .action(async (options) => {
      try {
        if (options.nonInteractive) {
          await runNonInteractive({
            mode: options.mode,
            provider: options.provider,
            port: options.port,
          });
        } else {
          await runInteractive();
        }
        process.exit(0);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Onboarding failed');
        process.exit(1);
      }
    });

  return cmd;
}
