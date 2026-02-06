/**
 * CLI Auth Commands
 *
 * Direct-to-DB commands for invite code management, password reset,
 * user management, and registration mode configuration.
 *
 * These commands connect to the database directly (not via API)
 * so they work without the server running.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { initStorage, getDb } from '../../storage/index.js';
import { users, sessions, inviteCodes } from '../../storage/schema.js';
import {
  generateInviteCode,
  hashInviteCode,
  hashPassword,
  generateRecoveryCodes,
  hashRecoveryCodes,
} from '../../auth/password.js';
import { getSettingsRaw, updateSettings, type Settings } from '../../settings/index.js';
import { createTable, success, error, info, warn } from '../utils/output.js';

/**
 * Ensure DB is initialized before running commands.
 */
async function ensureDb(): Promise<ReturnType<typeof getDb>> {
  await initStorage();
  const db = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

/**
 * Parse a duration string (e.g., "7d", "24h", "30m") into milliseconds.
 */
function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration: "${input}". Use format like 7d, 24h, 30m`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}

export function authCommands(): Command {
  const auth = new Command('auth')
    .description('Authentication & user management');

  // =========================================================================
  // glinr auth invite
  // =========================================================================
  auth
    .command('invite')
    .description('Generate invite code(s)')
    .option('-n, --count <n>', 'Number of codes to generate', '1')
    .option('--expires <duration>', 'Expiration (e.g., 7d, 24h)')
    .option('--label <label>', 'Label for tracking (e.g., "For Bob")')
    .action(async (options) => {
      try {
        const db = await ensureDb();
        const count = parseInt(options.count, 10);

        if (isNaN(count) || count < 1 || count > 50) {
          error('Count must be between 1 and 50');
          process.exit(1);
        }

        let expiresAt: Date | null = null;
        if (options.expires) {
          const durationMs = parseDuration(options.expires);
          expiresAt = new Date(Date.now() + durationMs);
        }

        const codes: string[] = [];

        for (let i = 0; i < count; i++) {
          const code = generateInviteCode();
          const codeHash = hashInviteCode(code);

          await db.insert(inviteCodes).values({
            id: randomUUID(),
            codeHash,
            createdBy: 'cli',
            expiresAt,
            createdAt: new Date(),
            label: options.label || null,
          });

          codes.push(code);
        }

        console.log('');
        success(`Generated ${count} invite code(s):`);
        console.log('');

        for (const code of codes) {
          console.log(`  ${chalk.bold.cyan(code)}`);
        }

        console.log('');
        if (expiresAt) {
          info(`Expires: ${expiresAt.toLocaleString()}`);
        }
        if (options.label) {
          info(`Label: ${options.label}`);
        }
        console.log(chalk.dim('  Share these codes with users who need to register.'));
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to generate invite codes');
        process.exit(1);
      }
    });

  // =========================================================================
  // glinr auth reset-password
  // =========================================================================
  auth
    .command('reset-password <email>')
    .description('Reset a user\'s password')
    .action(async (email) => {
      try {
        const db = await ensureDb();

        const result = await db
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);

        if (!result.length) {
          error(`User not found: ${email}`);
          process.exit(1);
        }

        const user = result[0];

        // Generate temporary password
        const { randomBytes } = await import('crypto');
        const tempPassword = randomBytes(8).toString('hex');
        const passwordHash = hashPassword(tempPassword);

        // Generate new recovery codes
        const recoveryCodes = generateRecoveryCodes(8);
        const hashedRecoveryCodes = hashRecoveryCodes(recoveryCodes);

        // Update user
        await db
          .update(users)
          .set({
            passwordHash,
            recoveryCodes: JSON.stringify(hashedRecoveryCodes),
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        // Invalidate all sessions
        await db.delete(sessions).where(eq(sessions.userId, user.id));

        console.log('');
        success(`Password reset for ${chalk.bold(user.name)} (${user.email})`);
        console.log('');
        console.log(`  Temporary password: ${chalk.bold.yellow(tempPassword)}`);
        console.log('');
        console.log('  Recovery codes:');
        for (const code of recoveryCodes) {
          console.log(`    ${chalk.dim(code)}`);
        }
        console.log('');
        warn('All existing sessions have been invalidated.');
        info('User should change their password after logging in.');
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to reset password');
        process.exit(1);
      }
    });

  // =========================================================================
  // glinr auth list-users
  // =========================================================================
  auth
    .command('list-users')
    .description('List all users')
    .option('--status <status>', 'Filter by status (active, suspended)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const db = await ensureDb();

        let query = db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            status: users.status,
            createdAt: users.createdAt,
          })
          .from(users);

        if (options.status) {
          query = query.where(eq(users.status, options.status));
        }

        const allUsers = await query.orderBy(users.createdAt);

        if (options.json) {
          console.log(JSON.stringify(allUsers, null, 2));
          return;
        }

        if (!allUsers.length) {
          info('No users found');
          return;
        }

        console.log('');
        const table = createTable(['Email', 'Name', 'Role', 'Status', 'Created']);
        for (const u of allUsers) {
          table.push([
            u.email,
            u.name,
            u.role === 'admin' ? chalk.yellow(u.role) : u.role,
            u.status === 'active' ? chalk.green(u.status) : chalk.red(u.status),
            u.createdAt ? new Date(u.createdAt as unknown as number).toLocaleDateString() : '-',
          ]);
        }
        console.log(table.toString());
        console.log(`\n  Total: ${allUsers.length} user(s)`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list users');
        process.exit(1);
      }
    });

  // =========================================================================
  // glinr auth list-invites
  // =========================================================================
  auth
    .command('list-invites')
    .description('List invite codes')
    .option('--unused', 'Show only unused codes')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const db = await ensureDb();

        const query = db
          .select({
            id: inviteCodes.id,
            createdBy: inviteCodes.createdBy,
            usedBy: inviteCodes.usedBy,
            usedAt: inviteCodes.usedAt,
            expiresAt: inviteCodes.expiresAt,
            createdAt: inviteCodes.createdAt,
            label: inviteCodes.label,
          })
          .from(inviteCodes);

        const allInvites = await query.orderBy(inviteCodes.createdAt);

        // Filter unused in-memory (drizzle isNull is verbose)
        const filtered = options.unused
          ? allInvites.filter((inv: { usedBy: string | null }) => !inv.usedBy)
          : allInvites;

        if (options.json) {
          console.log(JSON.stringify(filtered, null, 2));
          return;
        }

        if (!filtered.length) {
          info(options.unused ? 'No unused invite codes' : 'No invite codes found');
          return;
        }

        console.log('');
        const table = createTable(['Label', 'Created By', 'Status', 'Expires', 'Created']);
        for (const inv of filtered) {
          const isExpired = inv.expiresAt && new Date() > new Date(inv.expiresAt as unknown as number);
          let status: string;
          if (inv.usedBy) {
            status = chalk.dim('Used');
          } else if (isExpired) {
            status = chalk.red('Expired');
          } else {
            status = chalk.green('Available');
          }

          table.push([
            inv.label || chalk.dim('-'),
            inv.createdBy,
            status,
            inv.expiresAt ? new Date(inv.expiresAt as unknown as number).toLocaleDateString() : chalk.dim('Never'),
            inv.createdAt ? new Date(inv.createdAt as unknown as number).toLocaleDateString() : '-',
          ]);
        }
        console.log(table.toString());
        console.log(`\n  Total: ${filtered.length} invite(s)`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list invites');
        process.exit(1);
      }
    });

  // =========================================================================
  // glinr auth set-mode
  // =========================================================================
  auth
    .command('set-mode <mode>')
    .description('Set registration mode (open or invite)')
    .action(async (mode) => {
      try {
        if (mode !== 'open' && mode !== 'invite') {
          error('Mode must be "open" or "invite"');
          process.exit(1);
        }

        await initStorage();
        await updateSettings({
          system: { registrationMode: mode } as Settings['system'],
        });

        console.log('');
        success(`Registration mode set to ${chalk.bold(mode)}`);

        if (mode === 'invite') {
          info('New users must provide an invite code to register.');
          info('Generate codes with: glinr auth invite');
        } else {
          warn('Anyone can now register without an invite code.');
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to set mode');
        process.exit(1);
      }
    });

  return auth;
}
