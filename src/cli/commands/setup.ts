/**
 * CLI Setup Wizard
 *
 * Interactive first-time setup for profClaw.
 * Configures AI provider, admin account, registration mode, and GitHub OAuth.
 *
 * Usage:
 *   profclaw setup                     # Interactive wizard
 *   profclaw setup --non-interactive   # CI/Docker automation
 */

import { Command } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import { select, search, input, password as passwordPrompt, confirm, Separator } from '@inquirer/prompts';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { spawn, execFile } from 'child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as os from 'os';
import { createServer } from 'net';
import { initStorage, getDb, closeStorage, saveProviderConfig, loadAllProviderConfigs } from '../../storage/index.js';
import { users, inviteCodes } from '../../storage/schema.js';
import { PROVIDER_CATALOG } from '../providers.js';
import {
  hashPassword,
  validatePasswordStrength,
  generateRecoveryCodes,
  hashRecoveryCodes,
  generateInviteCode,
  hashInviteCode,
} from '../../auth/password.js';
import { updateSettings, type Settings } from '../../settings/index.js';
import { success, error, info, warn, spinner } from '../utils/output.js';

/** Render a step header with progress bar. */
function stepHeader(step: number, total: number, title: string): void {
  const barLen = 20;
  const filled = Math.round((step / total) * barLen);
  const bar = chalk.cyan('━'.repeat(filled)) + chalk.dim('━'.repeat(barLen - filled));
  console.log(`\n  ${bar}  ${chalk.dim(`${step}/${total}`)}  ${chalk.bold.white(title)}\n`);
}

// Helpers

function showBanner(): void {
  const banner = figlet.textSync('profClaw', {
    font: 'Standard',
    horizontalLayout: 'default',
  });
  console.log(chalk.cyan(banner));
  console.log(chalk.dim('  Setup Wizard\n'));
}

// Inquirer theme for consistent prefix
const theme = { prefix: '  ', style: { highlight: (text: string) => chalk.cyan.bold(text) } };

async function checkRedis(): Promise<boolean> {
  try {
    const IORedis = (await import('ioredis')).default;
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
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

async function checkOllama(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

interface ExistingAdmin {
  id: string;
  email: string;
  name: string;
}

async function getExistingAdmins(db: ReturnType<typeof getDb>): Promise<ExistingAdmin[]> {
  if (!db) return [];
  const admins = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.role, 'admin'));
  return admins;
}

async function checkAdminExists(db: ReturnType<typeof getDb>): Promise<boolean> {
  const admins = await getExistingAdmins(db);
  return admins.length > 0;
}

/**
 * Check if the profClaw server is running locally (for API-based admin creation).
 * When the CLI runs inside Docker alongside the server, using the API ensures
 * both processes see the same DB state (avoids LibSQL cross-process issues).
 */
async function getServerBaseUrl(): Promise<string | null> {
  const port = process.env.PORT || '3000';
  const url = `http://localhost:${port}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) return `http://localhost:${port}`;
  } catch { /* server not running */ }
  return null;
}

/**
 * Create or update admin via server API (preferred when server is running).
 * Returns recovery codes on success, null if API unavailable.
 */
async function createAdminViaApi(
  baseUrl: string,
  email: string,
  password: string,
  name: string,
): Promise<{ email: string; recoveryCodes: string[]; isNew: boolean } | null> {
  try {
    const res = await fetch(`${baseUrl}/api/setup/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json() as Record<string, unknown>;
    if (data.success && data.recoveryCodes) {
      return {
        email: (data.user as Record<string, string>)?.email || email,
        recoveryCodes: data.recoveryCodes as string[],
        isNew: true,
      };
    }
    if (data.error === 'Email already registered') {
      // Email exists — try password reset via direct DB (API doesn't expose this)
      return null;
    }
    // Other API error — fall back to direct DB
    return null;
  } catch {
    return null;
  }
}

function hasEnvKey(key: string): boolean {
  const val = process.env[key];
  return !!val && val !== '' && !val.startsWith('sk-ant-xxxx') && !val.startsWith('sk-xxxx');
}

// Step 1: System Check

async function detectConfiguredProvider(): Promise<string | null> {
  // Check env vars first
  for (const p of PROVIDER_CATALOG) {
    if (hasEnvKey(p.envVar)) return p.name;
  }
  // Check database (saved via saveProviderConfig)
  try {
    const saved = await loadAllProviderConfigs();
    const enabled = saved.find(s => s.enabled);
    if (enabled) {
      const match = PROVIDER_CATALOG.find(p => p.key === enabled.type);
      return match ? `${match.name} (saved)` : enabled.type;
    }
  } catch { /* db not ready yet */ }
  return null;
}

async function stepSystemCheck(db: ReturnType<typeof getDb>): Promise<{
  redisOk: boolean;
  hasAdmin: boolean;
  hasProvider: boolean;
  providerName: string | null;
}> {
  const spin = spinner('Checking system...');
  spin.start();

  const redisOk = await checkRedis();
  const hasAdmin = await checkAdminExists(db);
  const providerName = await detectConfiguredProvider();
  const hasProvider = !!providerName;

  spin.stop();

  const mark = (ok: boolean) => (ok ? chalk.green('  \u2713') : chalk.red('  \u2717'));

  console.log(`${mark(redisOk)} Redis: ${redisOk ? 'connected' : 'not reachable'}`);
  console.log(`${mark(hasAdmin)} Admin account: ${hasAdmin ? 'exists' : 'not created'}`);
  console.log(`${mark(hasProvider)} AI provider: ${providerName || 'not configured'}`);

  if (!redisOk) {
    warn('Redis is required for task processing.');
    info('Start Redis: docker compose up redis -d');
  }

  return { redisOk, hasAdmin, hasProvider, providerName };
}

// Step 2: AI Provider

async function stepAiProvider(
  status: { hasProvider: boolean; providerName: string | null },
): Promise<string> {
  if (status.hasProvider) {
    info(`AI provider already configured (${status.providerName}).`);
    try {
      const reconfigure = await confirm({
        message: 'Reconfigure AI provider?',
        default: false,
        theme,
      });
      if (!reconfigure) return status.providerName || 'configured';
    } catch { return status.providerName || 'configured'; }
  }

  // Detect which providers already have keys
  const detected = new Set<string>();
  for (const p of PROVIDER_CATALOG) {
    if (process.env[p.envVar]) detected.add(p.key);
  }
  // Check Ollama service
  const ollamaRunning = await checkOllama(process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
  if (ollamaRunning) detected.add('ollama');

  let choice: string;
  try {
    choice = await search<string>({
      message: 'Select AI provider (type to filter, arrows to navigate)',
      pageSize: 15,
      source: (term: string | undefined) => {
        const results: Array<Separator | { name: string; value: string; description: string; short: string }> = [];
        const filter = (term || '').toLowerCase();
        let lastCategory = '';

        for (const p of PROVIDER_CATALOG) {
          if (filter && ![p.name, p.key, p.models, p.category, p.tag]
            .some(s => s.toLowerCase().includes(filter))) {
            continue;
          }

          if (p.category !== lastCategory) {
            if (results.length > 0) results.push(new Separator());
            results.push(new Separator(chalk.bold.cyan(` ${p.category} `)));
            lastCategory = p.category;
          }

          const det = detected.has(p.key) ? chalk.green(' *') : '';
          const ollamaTag = p.key === 'ollama' && ollamaRunning ? 'detected' : p.tag;
          const tag = ollamaTag ? ` ${chalk.dim(`[${ollamaTag}]`)}` : '';
          results.push({
            name: `${p.name.padEnd(16)} ${chalk.dim(p.models)}${tag}${det}`,
            value: p.key,
            description: p.envVar,
            short: p.name,
          });
        }

        if (!filter || 'skip'.includes(filter)) {
          results.push(new Separator());
          results.push({
            name: chalk.dim('Skip for now'),
            value: 'skip',
            description: 'Configure later in Settings',
            short: 'Skip',
          });
        }

        return results;
      },
      theme,
    });
  } catch {
    return 'skip';
  }

  if (choice === 'skip') {
    info('AI provider skipped. You can configure it later in Settings.');
    return 'skip';
  }

  const chosen = PROVIDER_CATALOG.find(p => p.key === choice);
  if (!chosen) return 'skip';

  console.log(`\n  ${chalk.bold(chosen.name)} selected`);
  console.log(chalk.dim(`  Env var: ${chosen.envVar}`));

  // Ollama special case
  if (chosen.key === 'ollama') {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const spin = spinner(`Checking Ollama at ${ollamaUrl}...`);
    spin.start();
    const ollamaOk = await checkOllama(ollamaUrl);
    spin.stop();

    if (ollamaOk) {
      success(`Ollama reachable at ${ollamaUrl}`);
      await saveProviderConfig({ type: 'ollama', apiKey: ollamaUrl, enabled: true });
      await updateSettings({
        integrations: { ollamaEndpoint: ollamaUrl } as Settings['integrations'],
        plugins: { ollama: { enabled: true, autoStart: false } } as Settings['plugins'],
      });
      success('Ollama provider configured.');
    } else {
      warn(`Ollama not reachable at ${ollamaUrl}`);
      info('Start Ollama: docker compose --profile ai up -d');
      info('Then re-run: profclaw setup');
      await saveProviderConfig({ type: 'ollama', apiKey: ollamaUrl, enabled: true });
    }
    return 'ollama';
  }

  // Already detected
  if (detected.has(chosen.key)) {
    success(`${chosen.name} already configured from ${chosen.envVar}`);
    return chosen.key;
  }

  // Prompt for API key
  let apiKey: string;
  try {
    apiKey = await input({ message: chosen.envVar, theme });
  } catch { return 'skip'; }
  if (!apiKey) { warn('No key provided, skipping.'); return 'skip'; }

  try {
    await saveProviderConfig({ type: chosen.key, apiKey, enabled: true });
    success(`${chosen.name} provider configured.`);
    return chosen.key;
  } catch (err) {
    error(`Failed to save: ${err instanceof Error ? err.message : 'unknown'}`);
    return 'skip';
  }
}

// Step 3: Admin Account

async function createAdminUser(
  db: ReturnType<typeof getDb>,
  name: string,
  email: string,
  password: string,
): Promise<{ email: string; recoveryCodes: string[] }> {
  const passwordHash = hashPassword(password);
  const recoveryCodes = generateRecoveryCodes(8);
  const hashedCodes = hashRecoveryCodes(recoveryCodes);

  await db.insert(users).values({
    id: randomUUID(),
    email: email.toLowerCase(),
    name,
    passwordHash,
    role: 'admin',
    status: 'active',
    recoveryCodes: JSON.stringify(hashedCodes),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { email, recoveryCodes };
}

function showRecoveryCodes(codes: string[]): void {
  console.log('');
  warn('Save these recovery codes in a safe place:');
  console.log('');
  for (const code of codes) {
    console.log(`    ${chalk.yellow(code)}`);
  }
  console.log('');
  warn('These codes cannot be shown again!');
}

async function stepAdminAccount(
  db: ReturnType<typeof getDb>,
): Promise<string | null> {
  if (!db) {
    error('Database not available. Cannot create admin account.');
    return null;
  }

  const existingAdmins = await getExistingAdmins(db);

  if (existingAdmins.length > 0) {
    console.log(chalk.dim('  Existing admin accounts:'));
    for (const admin of existingAdmins) {
      console.log(`    ${chalk.green('\u2022')} ${admin.name} ${chalk.dim(`<${admin.email}>`)}`);
    }
    console.log('');

    let picked: string;
    try {
      picked = await select<string>({
        message: 'What would you like to do?',
        choices: [
          { name: 'Keep existing - no changes', value: 'keep' },
          { name: 'Reset password for an existing admin', value: 'reset' },
          { name: 'Create an additional admin', value: 'create' },
        ],
        theme,
      });
    } catch { return existingAdmins[0].email; }

    if (picked === 'keep') {
      success(`Keeping ${existingAdmins.length} existing admin(s).`);
      return existingAdmins[0].email;
    }

    if (picked === 'reset') {
      let targetAdmin = existingAdmins[0];
      if (existingAdmins.length > 1) {
        try {
          const adminId = await select<string>({
            message: 'Which admin?',
            choices: existingAdmins.map(a => ({
              name: `${a.name} ${chalk.dim(`<${a.email}>`)}`,
              value: a.id,
            })),
            theme,
          });
          targetAdmin = existingAdmins.find(a => a.id === adminId) || existingAdmins[0];
        } catch { return existingAdmins[0].email; }
      }

      let newPassword = '';
      while (true) {
        try {
          newPassword = await passwordPrompt({
            message: 'New password (min 8 chars, 1 letter, 1 number)',
            mask: '*',
            theme,
          });
        } catch { return existingAdmins[0].email; }
        const strengthError = validatePasswordStrength(newPassword);
        if (!strengthError) break;
        console.log(chalk.red(`  ${strengthError}`));
      }

      const newHash = hashPassword(newPassword);
      const recoveryCodes = generateRecoveryCodes(8);
      const hashedCodes = hashRecoveryCodes(recoveryCodes);

      await db.update(users)
        .set({
          passwordHash: newHash,
          recoveryCodes: JSON.stringify(hashedCodes),
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetAdmin.id));

      success(`Password reset for ${targetAdmin.email}`);
      showRecoveryCodes(recoveryCodes);
      return targetAdmin.email;
    }

    // picked === 'create' - fall through to create new admin
    console.log('');
  }

  // Create new admin
  let name: string;
  try {
    name = await input({ message: 'Name', theme });
  } catch { return existingAdmins.length > 0 ? existingAdmins[0].email : null; }

  if (!name) {
    warn('Admin account creation skipped.');
    return existingAdmins.length > 0 ? existingAdmins[0].email : null;
  }

  let email: string;
  try {
    email = await input({
      message: 'Email',
      validate: (val) => val.includes('@') || 'Must be a valid email address',
      theme,
    });
  } catch { return existingAdmins.length > 0 ? existingAdmins[0].email : null; }

  // Check email uniqueness
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (existing.length > 0) {
    error(`User with email ${email} already exists.`);
    return existingAdmins.length > 0 ? existingAdmins[0].email : null;
  }

  let pw = '';
  while (true) {
    try {
      pw = await passwordPrompt({
        message: 'Password (min 8 chars, 1 letter, 1 number)',
        mask: '*',
        theme,
      });
    } catch { return existingAdmins.length > 0 ? existingAdmins[0].email : null; }
    const strengthError = validatePasswordStrength(pw);
    if (!strengthError) break;
    console.log(chalk.red(`  ${strengthError}`));
  }

  // Prefer server API (avoids cross-process LibSQL issues in Docker)
  const serverUrl = await getServerBaseUrl();
  if (serverUrl) {
    const apiResult = await createAdminViaApi(serverUrl, email, pw, name);
    if (apiResult) {
      success(`Admin account created: ${apiResult.email}`);
      showRecoveryCodes(apiResult.recoveryCodes);
      return apiResult.email;
    }
  }

  // Fall back to direct DB
  const result = await createAdminUser(db, name, email, pw);
  success(`Admin account created: ${result.email}`);
  showRecoveryCodes(result.recoveryCodes);
  return result.email;
}

// Step 4: Registration Mode

async function stepRegistrationMode(
  db: ReturnType<typeof getDb>,
): Promise<{ mode: string; codes: string[] }> {
  let mode: string;
  try {
    mode = await select<string>({
      message: 'How should new users register?',
      choices: [
        { name: 'Invite only (more secure)', value: 'invite', description: 'Users need an invite code to sign up' },
        { name: 'Open registration', value: 'open', description: 'Anyone can create an account' },
      ],
      theme,
    });
  } catch { mode = 'invite'; }

  await updateSettings({
    system: { registrationMode: mode } as Settings['system'],
  });

  success(`Registration mode set to ${chalk.bold(mode)}.`);

  const codes: string[] = [];

  if (mode === 'invite' && db) {
    let generate: boolean;
    try {
      generate = await confirm({
        message: 'Generate 3 invite codes now?',
        default: true,
        theme,
      });
    } catch { generate = false; }

    if (generate) {
      for (let i = 0; i < 3; i++) {
        const code = generateInviteCode();
        const codeHash = hashInviteCode(code);
        await db.insert(inviteCodes).values({
          id: randomUUID(),
          codeHash,
          createdBy: 'setup-wizard',
          createdAt: new Date(),
          label: `Setup wizard #${i + 1}`,
        });
        codes.push(code);
      }
      console.log('');
      success('Invite codes generated:');
      for (const code of codes) {
        console.log(`    ${chalk.cyan.bold(code)}`);
      }
      console.log('');
      info('Share these with users who need to register.');
    }
  }

  return { mode, codes };
}

// Step 5: GitHub OAuth (optional)

async function stepGitHubOAuth(): Promise<boolean> {
  let configure: boolean;
  try {
    configure = await confirm({
      message: 'Configure GitHub OAuth login?',
      default: false,
      theme,
    });
  } catch { return false; }

  if (!configure) {
    info('GitHub OAuth skipped. Configure later in Settings.');
    return false;
  }

  const port = process.env.PORT || '3000';
  console.log('');
  info(`Callback URL: ${chalk.cyan(`http://localhost:${port}/api/auth/github/callback`)}`);
  info('Create a GitHub OAuth App at: https://github.com/settings/developers');
  console.log('');

  let clientId: string;
  let clientSecret: string;
  try {
    clientId = await input({ message: 'GitHub Client ID', theme });
    clientSecret = await input({ message: 'GitHub Client Secret', theme });
  } catch { return false; }

  if (!clientId || !clientSecret) {
    warn('Incomplete credentials, skipping GitHub OAuth.');
    return false;
  }

  await updateSettings({
    oauth: {
      github: {
        clientId,
        clientSecret,
        redirectUri: `http://localhost:${port}/api/auth/github/callback`,
      },
    } as Settings['oauth'],
  });

  success('GitHub OAuth configured.');
  return true;
}

// Step 6: Summary

const execFileAsync = promisify(execFile);

interface HealthCheckResult {
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

async function runQuickHealthCheck(): Promise<void> {
  const results: HealthCheckResult[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  results.push({
    label: 'Node.js',
    status: nodeMajor >= 20 ? 'pass' : 'warn',
    detail: nodeMajor >= 20 ? nodeVersion : `${nodeVersion} (v20+ recommended)`,
  });

  // 2. Config files
  const cwd = process.cwd();
  const settingsExists = existsSync(join(cwd, 'config', 'settings.yml'));
  const envExists = existsSync(join(cwd, '.env'));
  const configStatus = settingsExists && envExists ? 'pass' : settingsExists || envExists ? 'warn' : 'fail';
  const configDetail =
    settingsExists && envExists
      ? 'settings.yml + .env found'
      : settingsExists
        ? 'settings.yml found, .env missing'
        : envExists
          ? '.env found, settings.yml missing'
          : 'settings.yml and .env not found';
  results.push({ label: 'Config', status: configStatus, detail: configDetail });

  // 3. Database — initStorage() already ran, so if we get here the DB is initialized
  results.push({ label: 'Database', status: 'pass', detail: 'Initialized' });

  // 4. Memory
  const freeBytes = os.freemem();
  const freeMb = freeBytes / 1024 / 1024;
  const freeGb = freeBytes / 1024 / 1024 / 1024;
  const memDetail = freeGb >= 1 ? `${freeGb.toFixed(1)} GB free` : `${Math.round(freeMb)} MB free`;
  results.push({
    label: 'Memory',
    status: freeMb >= 256 ? 'pass' : 'warn',
    detail: freeMb >= 256 ? memDetail : `${memDetail} (low)`,
  });

  // 5. Disk — df on cwd
  let diskDetail = 'unavailable';
  let diskStatus: 'pass' | 'warn' | 'fail' = 'warn';
  try {
    const { stdout } = await execFileAsync('df', ['-k', cwd]);
    const lines = stdout.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/);
      // df -k columns: Filesystem 1K-blocks Used Available Use% Mounted (macOS/Linux may vary)
      const availIdx = parts.length >= 4 ? (parts.length === 6 ? 3 : parts.length - 3) : -1;
      const useIdx = parts.length >= 5 ? parts.length - 2 : -1;
      if (availIdx !== -1 && useIdx !== -1) {
        const availKb = parseInt(parts[availIdx], 10);
        const usePercent = parts[useIdx];
        const availGb = availKb / 1024 / 1024;
        diskDetail = `${availGb.toFixed(0)} GB free (${usePercent} used)`;
        diskStatus = availGb >= 1 ? 'pass' : 'warn';
      }
    }
  } catch { /* df not available */ }
  results.push({ label: 'Disk', status: diskStatus, detail: diskDetail });

  // Render
  const icon = (s: HealthCheckResult['status']) =>
    s === 'pass' ? chalk.green('\u2713') : s === 'warn' ? chalk.yellow('\u26a0') : chalk.red('\u2717');
  const labelWidth = 12;

  console.log('');
  console.log(chalk.bold.white('  Quick Health Check'));
  console.log('  ' + '\u2500'.repeat(44));
  for (const r of results) {
    const label = r.label.padEnd(labelWidth);
    console.log(`  ${icon(r.status)} ${chalk.dim(label)} ${r.detail}`);
  }
  console.log('  ' + '\u2500'.repeat(44));

  const passed = results.filter(r => r.status === 'pass').length;
  const total = results.length;
  const summary = passed === total ? chalk.green(`${passed}/${total} checks passed`) : chalk.yellow(`${passed}/${total} checks passed`);
  console.log(`  ${summary}`);
}

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port);
  });
}

async function showSummaryAndOffer(results: {
  redisOk: boolean;
  aiProvider: string;
  adminEmail: string | null;
  registrationMode: string;
  inviteCodes: string[];
  githubOAuth: boolean;
  fromOnboard?: boolean;
}): Promise<void> {
  const port = parseInt(process.env.PORT || '3000', 10);

  console.log(chalk.bold.white('\n  Setup Complete!\n'));
  console.log('  ' + '\u2500'.repeat(44));

  const mark = (ok: boolean) => (ok ? chalk.green('\u2713') : chalk.yellow('\u2717'));

  console.log(`  ${mark(results.redisOk)} Redis: ${results.redisOk ? 'connected' : 'not connected'}`);
  console.log(`  ${mark(results.aiProvider !== 'skip')} AI: ${results.aiProvider === 'skip' ? 'not configured' : results.aiProvider}`);
  console.log(`  ${mark(!!results.adminEmail)} Admin: ${results.adminEmail || 'not created'}`);
  console.log(`  ${mark(true)} Registration: ${results.registrationMode}${results.inviteCodes.length ? ` (${results.inviteCodes.length} codes)` : ''}`);
  console.log(`  ${mark(results.githubOAuth)} GitHub OAuth: ${results.githubOAuth ? 'configured' : 'skipped'}`);

  console.log('  ' + '\u2500'.repeat(44));

  await runQuickHealthCheck();

  // Check if server is already running
  const portFree = await checkPortAvailable(port);
  const serverRunning = !portFree;

  if (serverRunning) {
    // Server already running - just show the URL
    console.log('');
    success(`Server already running on port ${port}`);
    console.log(`\n  ${chalk.cyan.bold(`http://localhost:${port}`)}\n`);
  } else {
    // Offer to start the server
    console.log('');
    let startServer = false;
    try {
      startServer = await confirm({
        message: 'Start the server now?',
        default: true,
        theme,
      });
    } catch { /* Ctrl+C */ }

    if (startServer) {
      console.log('');
      const startSpin = spinner('Starting server...');
      startSpin.start();

      // Determine runtime
      const distPath = 'dist/server.js';
      const useCompiled = existsSync(distPath);
      const cmd = useCompiled ? 'node' : 'npx';
      const args = useCompiled ? [distPath] : ['tsx', 'src/server.ts'];

      // Redirect server output to log file (keep terminal clean)
      const logDir = join(process.cwd(), 'data');
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      const logPath = join(logDir, 'server.log');
      const logFd = openSync(logPath, 'a');

      const child = spawn(cmd, args, {
        stdio: ['ignore', logFd, logFd],
        detached: true,
        env: { ...process.env, PORT: String(port) },
      });

      child.unref();

      // Wait for server to start, polling health check
      let serverOk = false;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const res = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) { serverOk = true; break; }
        } catch { /* not ready yet */ }
      }

      startSpin.stop();

      if (serverOk) {
        success(`Server running on port ${port}`);
      } else {
        warn('Server starting in background (health check pending)');
      }

      console.log(`\n  ${chalk.cyan.bold(`http://localhost:${port}`)}`);
      console.log('');
      console.log(chalk.dim('  Server is running in the background.'));
      console.log(chalk.dim(`  Stop:    ${chalk.white('profclaw daemon stop')}  or  ${chalk.white(`kill $(lsof -ti :${port})`)}`));
      console.log(chalk.dim(`  Logs:    ${chalk.white(`tail -f ${logPath}`)}`));
      console.log(chalk.dim(`  Status:  ${chalk.white('profclaw doctor')}`));
    } else {
      console.log('');
      console.log(`  Start later with: ${chalk.cyan.bold('profclaw serve')}`);
    }
  }

  // Always show helpful next steps
  console.log('');
  console.log(chalk.bold.white('  Next Steps'));
  console.log('  ' + '\u2500'.repeat(44));
  console.log(`  ${chalk.cyan('profclaw doctor')}          Health check (12 tests)`);
  console.log(`  ${chalk.cyan('profclaw chat quick')} ${chalk.dim('"hi"')}  Chat with AI`);
  console.log(`  ${chalk.cyan('profclaw task list')}        View agent tasks`);
  console.log(`  ${chalk.cyan('profclaw tools list')}       Available tools`);
  console.log(`  ${chalk.cyan('profclaw provider test')}    Test AI provider`);
  console.log(`  ${chalk.cyan('profclaw --help')}           All commands`);
  console.log('');
}

// Non-Interactive Mode

async function runNonInteractive(options: {
  adminEmail?: string;
  adminPassword?: string;
  adminName?: string;
  aiProvider?: string;
  registrationMode?: string;
}): Promise<void> {
  showBanner();
  console.log(chalk.dim('  Running in non-interactive mode...\n'));

  await initStorage();
  const db = getDb();
  if (!db) {
    error('Failed to initialize database.');
    process.exit(1);
  }

  // System check
  const redisOk = await checkRedis();
  console.log(`  ${redisOk ? chalk.green('✓') : chalk.red('✗')} Redis: ${redisOk ? 'connected' : 'not reachable'}`);

  // AI Provider
  const aiChoice = options.aiProvider || 'skip';
  if (aiChoice !== 'skip') {
    info(`AI provider: ${aiChoice} (configure key via env var or settings)`);
  }

  // Admin Account
  let adminEmail: string | null = null;
  if (options.adminEmail && options.adminPassword) {
    const strengthError = validatePasswordStrength(options.adminPassword);
    if (strengthError) {
      error(`Password too weak: ${strengthError}`);
      process.exit(1);
    }

    const emailLower = options.adminEmail.toLowerCase();
    const name = options.adminName || 'Admin';

    // Try server API first (ensures server sees the new user immediately)
    const serverUrl = await getServerBaseUrl();
    let handled = false;

    if (serverUrl) {
      const apiResult = await createAdminViaApi(serverUrl, emailLower, options.adminPassword, name);
      if (apiResult) {
        adminEmail = apiResult.email;
        success(`Admin created: ${adminEmail}`);
        console.log('');
        warn('Recovery codes (save these!):');
        for (const code of apiResult.recoveryCodes) {
          console.log(`    ${code}`);
        }
        console.log('');
        handled = true;
      }
    }

    // Fall back to direct DB if API unavailable or email already exists
    if (!handled) {
      const existingAdmins = await getExistingAdmins(db);
      const matchingAdmin = existingAdmins.find(a => a.email === emailLower);

      if (matchingAdmin) {
        // Admin with this email exists — update password
        const newHash = hashPassword(options.adminPassword);
        const recoveryCodes = generateRecoveryCodes(8);
        const hashedCodes = hashRecoveryCodes(recoveryCodes);

        await db.update(users)
          .set({
            passwordHash: newHash,
            recoveryCodes: JSON.stringify(hashedCodes),
            updatedAt: new Date(),
          })
          .where(eq(users.id, matchingAdmin.id));

        adminEmail = matchingAdmin.email;
        success(`Admin password updated: ${adminEmail}`);

        console.log('');
        warn('Recovery codes (save these!):');
        for (const code of recoveryCodes) {
          console.log(`    ${code}`);
        }
        console.log('');
      } else {
        // Create new admin directly in DB
        const result = await createAdminUser(db, name, emailLower, options.adminPassword);
        adminEmail = result.email;
        success(`Admin created: ${adminEmail}`);

        console.log('');
        warn('Recovery codes (save these!):');
        for (const code of result.recoveryCodes) {
          console.log(`    ${code}`);
        }
        console.log('');
      }
    }
  }

  // Registration Mode
  const regMode = options.registrationMode || 'invite';
  await updateSettings({
    system: { registrationMode: regMode as 'open' | 'invite' } as Settings['system'],
  });
  success(`Registration mode: ${regMode}`);

  // Generate invite codes if invite mode
  if (regMode === 'invite') {
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const code = generateInviteCode();
      const codeHash = hashInviteCode(code);
      await db.insert(inviteCodes).values({
        id: randomUUID(),
        codeHash,
        createdBy: 'setup-wizard',
        createdAt: new Date(),
        label: `Setup #${i + 1}`,
      });
      codes.push(code);
    }
    success('Invite codes:');
    for (const code of codes) {
      console.log(`    ${code}`);
    }
  }

  console.log('');
  success('Setup complete.');
}

// Command Registration

export function setupCommand(): Command {
  const cmd = new Command('setup')
    .description('Interactive first-time setup wizard')
    .option('--non-interactive', 'Run without prompts (for CI/Docker)')
    .option('--admin-email <email>', 'Admin email (non-interactive)')
    .option('--admin-password <password>', 'Admin password (non-interactive)')
    .option('--admin-name <name>', 'Admin display name (non-interactive)')
    .option('--ai-provider <provider>', 'AI provider: anthropic, openai, ollama, skip (non-interactive)')
    .option('--registration-mode <mode>', 'Registration mode: invite, open (non-interactive)')
    .option('--from-onboard', 'Called from onboard wizard (skip AI provider)')
    .action(async (options) => {
      try {
        // Non-interactive mode
        if (options.nonInteractive) {
          await runNonInteractive({
            adminEmail: options.adminEmail,
            adminPassword: options.adminPassword,
            adminName: options.adminName,
            aiProvider: options.aiProvider,
            registrationMode: options.registrationMode,
          });
          await closeStorage();
          process.exit(0);
        }

        const fromOnboard = !!options.fromOnboard;

        // Interactive mode
        if (!fromOnboard) showBanner();

        // Suppress initialization noise ([INFO] Initializing LibSQL storage, etc.)
        const _origLog = console.log;
        console.log = (...args: unknown[]) => {
          const msg = String(args[0] || '');
          if (msg.includes('[INFO]') || msg.includes('[DEBUG]')) return;
          _origLog.apply(console, args);
        };

        const spin = spinner('Initializing...');
        spin.start();
        await initStorage();
        const db = getDb();
        spin.stop();

        // Restore console
        console.log = _origLog;

        if (!db) {
          error('Failed to initialize database.');
          process.exit(1);
        }

        // Dynamic step numbering
        // Standalone: 5 steps (System Check, AI Provider, Admin, Registration, GitHub OAuth)
        // From onboard: continues at step 5 of 6 (onboard did 1-4)
        const totalSteps = fromOnboard ? 6 : 5;
        let step = fromOnboard ? 4 : 0;

        // System Check (skip if from onboard - already done)
        let status: { redisOk: boolean; hasAdmin: boolean; hasProvider: boolean; providerName: string | null };
        if (fromOnboard) {
          // Quick silent check
          const redisOk = await checkRedis();
          const hasAdmin = await checkAdminExists(db);
          const providerName = await detectConfiguredProvider();
          status = { redisOk, hasAdmin, hasProvider: !!providerName, providerName };
        } else {
          step++;
          stepHeader(step, totalSteps, 'System Check');
          status = await stepSystemCheck(db);
        }

        // AI Provider (skip if from onboard - already configured)
        let aiProvider = 'skip';
        if (!fromOnboard) {
          step++;
          stepHeader(step, totalSteps, 'AI Provider');
          aiProvider = await stepAiProvider(status);
        }

        // Admin Account
        step++;
        stepHeader(step, totalSteps, 'Admin Account');
        const adminEmail = await stepAdminAccount(db);

        // Registration Mode
        step++;
        stepHeader(step, totalSteps, 'Registration Mode');
        const regResult = await stepRegistrationMode(db);

        // GitHub OAuth (skip if from onboard to keep it shorter)
        let githubOAuth = false;
        if (!fromOnboard) {
          step++;
          stepHeader(step, totalSteps, 'GitHub OAuth');
          githubOAuth = await stepGitHubOAuth();
        }

        // Summary + offer to start server
        await showSummaryAndOffer({
          redisOk: status.redisOk,
          aiProvider,
          adminEmail,
          registrationMode: regResult.mode,
          inviteCodes: regResult.codes,
          githubOAuth,
          fromOnboard,
        });

        await closeStorage();
        process.exit(0);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Setup failed');
        await closeStorage();
        process.exit(1);
      }
    });

  return cmd;
}
