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
import { createInterface } from 'readline/promises';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { initStorage, getDb, saveProviderConfig } from '../../storage/index.js';
import { users, inviteCodes } from '../../storage/schema.js';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showBanner(): void {
  const banner = figlet.textSync('profClaw', {
    font: 'Standard',
    horizontalLayout: 'default',
  });
  console.log(chalk.cyan(banner));
  console.log(chalk.dim('  Setup Wizard\n'));
}

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(chalk.bold(question));
  return answer.trim();
}

async function promptPassword(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  // readline/promises doesn't natively hide input, but for a CLI wizard this is acceptable
  const answer = await rl.question(chalk.bold(question));
  return answer.trim();
}

async function promptChoice(
  rl: ReturnType<typeof createInterface>,
  question: string,
  options: { key: string; label: string }[],
): Promise<string> {
  console.log('');
  console.log(chalk.bold(question));
  for (const opt of options) {
    console.log(`  ${chalk.cyan(opt.key)}) ${opt.label}`);
  }
  const validKeys = options.map((o) => o.key);
  while (true) {
    const answer = await prompt(rl, `Choice [${validKeys.join('/')}]: `);
    if (validKeys.includes(answer)) return answer;
    console.log(chalk.red(`  Invalid choice. Options: ${validKeys.join(', ')}`));
  }
}

async function promptYesNo(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultYes = false,
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await prompt(rl, `${question} [${hint}]: `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

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

// ---------------------------------------------------------------------------
// Step 1: System Check
// ---------------------------------------------------------------------------

async function stepSystemCheck(db: ReturnType<typeof getDb>): Promise<{
  redisOk: boolean;
  hasAdmin: boolean;
  hasAnthropicKey: boolean;
  hasOpenAIKey: boolean;
}> {
  console.log(chalk.bold.white('\n  Step 1: System Check\n'));

  const spin = spinner('Checking system...');
  spin.start();

  const redisOk = await checkRedis();
  const hasAdmin = await checkAdminExists(db);
  const hasAnthropicKey = hasEnvKey('ANTHROPIC_API_KEY');
  const hasOpenAIKey = hasEnvKey('OPENAI_API_KEY');

  spin.stop();

  const mark = (ok: boolean) => (ok ? chalk.green('  ✓') : chalk.red('  ✗'));

  console.log(`${mark(redisOk)} Redis: ${redisOk ? 'connected' : 'not reachable'}`);
  console.log(`${mark(hasAdmin)} Admin account: ${hasAdmin ? 'exists' : 'not created'}`);
  console.log(`${mark(hasAnthropicKey || hasOpenAIKey)} AI provider: ${
    hasAnthropicKey ? 'Anthropic key found' :
    hasOpenAIKey ? 'OpenAI key found' :
    'not configured'
  }`);

  if (!redisOk) {
    warn('Redis is required for task processing.');
    info('Start Redis: docker compose up redis -d');
  }

  return { redisOk, hasAdmin, hasAnthropicKey, hasOpenAIKey };
}

// ---------------------------------------------------------------------------
// Step 2: AI Provider
// ---------------------------------------------------------------------------

async function stepAiProvider(
  rl: ReturnType<typeof createInterface>,
  status: { hasAnthropicKey: boolean; hasOpenAIKey: boolean },
): Promise<string> {
  if (status.hasAnthropicKey || status.hasOpenAIKey) {
    const provider = status.hasAnthropicKey ? 'Anthropic' : 'OpenAI';
    info(`AI provider already configured (${provider} from env).`);
    const reconfigure = await promptYesNo(rl, '  Reconfigure AI provider?', false);
    if (!reconfigure) return 'skip';
  }

  const choice = await promptChoice(rl, '  Select AI Provider:', [
    { key: '1', label: 'Anthropic API Key (recommended)' },
    { key: '2', label: 'OpenAI API Key' },
    { key: '3', label: 'Ollama (free, local AI)' },
    { key: '4', label: 'Skip for now' },
  ]);

  if (choice === '4') {
    info('AI provider skipped. You can configure it later in Settings.');
    return 'skip';
  }

  if (choice === '1') {
    const apiKey = await prompt(rl, '  Anthropic API Key: ');
    if (!apiKey) {
      warn('No key provided, skipping.');
      return 'skip';
    }
    await saveProviderConfig({ type: 'anthropic', apiKey, enabled: true });
    success('Anthropic provider configured.');
    return 'anthropic';
  }

  if (choice === '2') {
    const apiKey = await prompt(rl, '  OpenAI API Key: ');
    if (!apiKey) {
      warn('No key provided, skipping.');
      return 'skip';
    }
    await saveProviderConfig({ type: 'openai', apiKey, enabled: true });
    success('OpenAI provider configured.');
    return 'openai';
  }

  // Ollama
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

// ---------------------------------------------------------------------------
// Step 3: Admin Account
// ---------------------------------------------------------------------------

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
  rl: ReturnType<typeof createInterface>,
  db: ReturnType<typeof getDb>,
): Promise<string | null> {
  if (!db) {
    error('Database not available. Cannot create admin account.');
    return null;
  }

  console.log(chalk.bold.white('\n  Step 3: Admin Account\n'));

  const existingAdmins = await getExistingAdmins(db);

  if (existingAdmins.length > 0) {
    console.log(chalk.dim('  Existing admin accounts:'));
    for (const admin of existingAdmins) {
      console.log(`    ${chalk.green('•')} ${admin.name} ${chalk.dim(`<${admin.email}>`)}`);
    }
    console.log('');
    console.log('  What would you like to do?');
    console.log(`    ${chalk.bold('1)')} Keep existing — no changes`);
    console.log(`    ${chalk.bold('2)')} Reset password for an existing admin`);
    console.log(`    ${chalk.bold('3)')} Create an additional admin`);
    console.log('');

    const choice = await prompt(rl, '  Choice [1]: ');
    const picked = choice || '1';

    if (picked === '1') {
      success(`Keeping ${existingAdmins.length} existing admin(s).`);
      return existingAdmins[0].email;
    }

    if (picked === '2') {
      // Reset password for existing admin
      let targetAdmin = existingAdmins[0];
      if (existingAdmins.length > 1) {
        console.log('');
        for (let i = 0; i < existingAdmins.length; i++) {
          console.log(`    ${chalk.bold(`${i + 1})`)} ${existingAdmins[i].email}`);
        }
        const idx = await prompt(rl, `  Which admin? [1]: `);
        const n = parseInt(idx || '1', 10) - 1;
        if (n >= 0 && n < existingAdmins.length) {
          targetAdmin = existingAdmins[n];
        }
      }

      let newPassword = '';
      while (true) {
        newPassword = await promptPassword(rl, '  New password (min 8 chars, 1 letter, 1 number): ');
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

    // picked === '3' — fall through to create new admin
    console.log('');
  }

  // Create new admin
  const name = await prompt(rl, '  Name: ');
  if (!name) {
    warn('Admin account creation skipped.');
    return existingAdmins.length > 0 ? existingAdmins[0].email : null;
  }

  const email = await prompt(rl, '  Email: ');
  if (!email || !email.includes('@')) {
    error('Invalid email address.');
    return existingAdmins.length > 0 ? existingAdmins[0].email : null;
  }

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

  let password = '';
  while (true) {
    password = await promptPassword(rl, '  Password (min 8 chars, 1 letter, 1 number): ');
    const strengthError = validatePasswordStrength(password);
    if (!strengthError) break;
    console.log(chalk.red(`  ${strengthError}`));
  }

  // Prefer server API (avoids cross-process LibSQL issues in Docker)
  const serverUrl = await getServerBaseUrl();
  if (serverUrl) {
    const apiResult = await createAdminViaApi(serverUrl, email, password, name);
    if (apiResult) {
      success(`Admin account created: ${apiResult.email}`);
      showRecoveryCodes(apiResult.recoveryCodes);
      return apiResult.email;
    }
  }

  // Fall back to direct DB
  const result = await createAdminUser(db, name, email, password);
  success(`Admin account created: ${result.email}`);
  showRecoveryCodes(result.recoveryCodes);
  return result.email;
}

// ---------------------------------------------------------------------------
// Step 4: Registration Mode
// ---------------------------------------------------------------------------

async function stepRegistrationMode(
  rl: ReturnType<typeof createInterface>,
  db: ReturnType<typeof getDb>,
): Promise<{ mode: string; codes: string[] }> {
  console.log(chalk.bold.white('\n  Step 4: Registration Mode\n'));

  const choice = await promptChoice(rl, '  How should new users register?', [
    { key: '1', label: 'Invite only (default, more secure)' },
    { key: '2', label: 'Open registration' },
  ]);

  const mode = choice === '1' ? 'invite' : 'open';
  await updateSettings({
    system: { registrationMode: mode } as Settings['system'],
  });

  success(`Registration mode set to ${chalk.bold(mode)}.`);

  const codes: string[] = [];

  if (mode === 'invite' && db) {
    const generate = await promptYesNo(rl, '  Generate 3 invite codes now?', true);
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

// ---------------------------------------------------------------------------
// Step 5: GitHub OAuth (optional)
// ---------------------------------------------------------------------------

async function stepGitHubOAuth(rl: ReturnType<typeof createInterface>): Promise<boolean> {
  console.log(chalk.bold.white('\n  Step 5: GitHub OAuth (Optional)\n'));

  const configure = await promptYesNo(rl, '  Configure GitHub OAuth login?', false);
  if (!configure) {
    info('GitHub OAuth skipped. Configure later in Settings.');
    return false;
  }

  const port = process.env.PORT || '3000';
  console.log('');
  info(`Callback URL: ${chalk.cyan(`http://localhost:${port}/api/auth/github/callback`)}`);
  info('Create a GitHub OAuth App at: https://github.com/settings/developers');
  console.log('');

  const clientId = await prompt(rl, '  GitHub Client ID: ');
  const clientSecret = await prompt(rl, '  GitHub Client Secret: ');

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

// ---------------------------------------------------------------------------
// Step 6: Summary
// ---------------------------------------------------------------------------

function showSummary(results: {
  redisOk: boolean;
  aiProvider: string;
  adminEmail: string | null;
  registrationMode: string;
  inviteCodes: string[];
  githubOAuth: boolean;
}): void {
  const port = process.env.PORT || '3000';

  console.log(chalk.bold.white('\n  Setup Complete!\n'));
  console.log('  ' + '─'.repeat(44));

  const mark = (ok: boolean) => (ok ? chalk.green('✓') : chalk.yellow('✗'));

  console.log(`  ${mark(results.redisOk)} Redis: ${results.redisOk ? 'connected' : 'not connected'}`);
  console.log(`  ${mark(results.aiProvider !== 'skip')} AI: ${results.aiProvider === 'skip' ? 'not configured' : results.aiProvider}`);
  console.log(`  ${mark(!!results.adminEmail)} Admin: ${results.adminEmail || 'not created'}`);
  console.log(`  ${mark(true)} Registration: ${results.registrationMode}${results.inviteCodes.length ? ` (${results.inviteCodes.length} codes)` : ''}`);
  console.log(`  ${mark(results.githubOAuth)} GitHub OAuth: ${results.githubOAuth ? 'configured' : 'skipped'}`);

  console.log('  ' + '─'.repeat(44));
  console.log('');
  console.log(`  Open ${chalk.cyan.bold(`http://localhost:${port}`)} to get started.`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Non-Interactive Mode
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function setupCommand(): Command {
  const cmd = new Command('setup')
    .description('Interactive first-time setup wizard')
    .option('--non-interactive', 'Run without prompts (for CI/Docker)')
    .option('--admin-email <email>', 'Admin email (non-interactive)')
    .option('--admin-password <password>', 'Admin password (non-interactive)')
    .option('--admin-name <name>', 'Admin display name (non-interactive)')
    .option('--ai-provider <provider>', 'AI provider: anthropic, openai, ollama, skip (non-interactive)')
    .option('--registration-mode <mode>', 'Registration mode: invite, open (non-interactive)')
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
          return;
        }

        // Interactive mode
        showBanner();

        const spin = spinner('Initializing...');
        spin.start();
        await initStorage();
        const db = getDb();
        spin.stop();

        if (!db) {
          error('Failed to initialize database.');
          process.exit(1);
        }

        // Create a single readline interface for all steps
        const rl = createInterface({ input: process.stdin, output: process.stdout });

        // Step 1: System Check
        const status = await stepSystemCheck(db);

        // Step 2: AI Provider
        console.log(chalk.bold.white('\n  Step 2: AI Provider\n'));
        const aiProvider = await stepAiProvider(rl, status);

        // Step 3: Admin Account
        const adminEmail = await stepAdminAccount(rl, db);

        // Step 4: Registration Mode
        const regResult = await stepRegistrationMode(rl, db);

        // Step 5: GitHub OAuth
        const githubOAuth = await stepGitHubOAuth(rl);

        rl.close();

        // Step 6: Summary
        showSummary({
          redisOk: status.redisOk,
          aiProvider,
          adminEmail,
          registrationMode: regResult.mode,
          inviteCodes: regResult.codes,
          githubOAuth,
        });
      } catch (err) {
        error(err instanceof Error ? err.message : 'Setup failed');
        process.exit(1);
      }
    });

  return cmd;
}
