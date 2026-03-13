import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawnSync } from 'child_process';
import chalk from 'chalk';
import { success, error, info, warn } from '../utils/output.js';

const PLIST_LABEL = 'com.profclaw.agent';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
const SYSTEMD_PATH = path.join(os.homedir(), '.config', 'systemd', 'user', 'profclaw.service');
const LOG_DIR = path.join(os.homedir(), '.profclaw');
const ENV_PATH = path.join(process.cwd(), '.env');
const PLATFORM = process.platform;

// Restart limits to prevent infinite crash loops
const MACOS_THROTTLE_INTERVAL = 10; // seconds between restart attempts
const SYSTEMD_RESTART_SEC = 5;
const SYSTEMD_START_LIMIT_BURST = 5;
const SYSTEMD_START_LIMIT_INTERVAL_SEC = 60; // 5 attempts per 60 seconds

function getProfClawBin(): string {
  try {
    const bin = execSync('which profclaw', { encoding: 'utf8' }).trim();
    return bin || 'profclaw';
  } catch {
    return process.argv[1] || 'profclaw';
  }
}

function getWorkingDirectory(): string {
  // Prefer PROFCLAW_HOME, fall back to cwd
  return process.env.PROFCLAW_HOME || process.cwd();
}

function generatePlist(bin: string): string {
  const workDir = getWorkingDirectory();
  const logPath = path.join(LOG_DIR, 'daemon.log');
  const errPath = path.join(LOG_DIR, 'daemon-error.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>serve</string>
    <string>--no-restart</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${workDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>${MACOS_THROTTLE_INTERVAL}</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${errPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${process.env.HOME}/.nvm/versions/node/${process.version}/bin</string>
  </dict>
</dict>
</plist>`;
}

function generateSystemdUnit(bin: string): string {
  const workDir = getWorkingDirectory();
  const envLine = fs.existsSync(ENV_PATH)
    ? `EnvironmentFile=${ENV_PATH}`
    : `# No .env found at ${ENV_PATH} - set environment variables manually`;

  return `[Unit]
Description=profClaw AI Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=${workDir}
ExecStart=${bin} serve --no-restart
Restart=on-failure
RestartSec=${SYSTEMD_RESTART_SEC}
StartLimitBurst=${SYSTEMD_START_LIMIT_BURST}
StartLimitIntervalSec=${SYSTEMD_START_LIMIT_INTERVAL_SEC}
${envLine}
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal
SyslogIdentifier=profclaw

[Install]
WantedBy=default.target
`;
}

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotateLogs(): void {
  const logFile = path.join(LOG_DIR, 'daemon.log');
  const errFile = path.join(LOG_DIR, 'daemon-error.log');
  const maxSize = 10 * 1024 * 1024; // 10 MB

  for (const file of [logFile, errFile]) {
    try {
      if (!fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      if (stat.size > maxSize) {
        const rotated = `${file}.1`;
        // Keep only one rotation
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(file, rotated);
        info(`Rotated ${path.basename(file)} (${Math.round(stat.size / 1024 / 1024)}MB)`);
      }
    } catch {
      // Non-critical, skip
    }
  }
}

export function daemonCommand(): Command {
  const cmd = new Command('daemon')
    .description('Manage profClaw as a system service (launchd/systemd)');

  cmd
    .command('install')
    .description('Install profClaw as a system service')
    .action(() => {
      const bin = getProfClawBin();
      try {
        if (PLATFORM === 'darwin') {
          ensureLogDir();
          fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
          fs.writeFileSync(PLIST_PATH, generatePlist(bin), 'utf8');
          success(`launchd plist installed: ${chalk.dim(PLIST_PATH)}`);
          info(`Working directory: ${getWorkingDirectory()}`);
          info(`Throttle interval: ${MACOS_THROTTLE_INTERVAL}s (prevents crash loops)`);
          info('Run: profclaw daemon start');
        } else if (PLATFORM === 'linux') {
          fs.mkdirSync(path.dirname(SYSTEMD_PATH), { recursive: true });
          fs.writeFileSync(SYSTEMD_PATH, generateSystemdUnit(bin), 'utf8');
          spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
          success(`systemd unit installed: ${chalk.dim(SYSTEMD_PATH)}`);
          info(`Working directory: ${getWorkingDirectory()}`);
          info(`Restart limits: ${SYSTEMD_START_LIMIT_BURST} attempts per ${SYSTEMD_START_LIMIT_INTERVAL_SEC}s`);
          if (fs.existsSync(ENV_PATH)) {
            info(`Environment file: ${ENV_PATH}`);
          } else {
            warn(`No .env found at ${ENV_PATH} - set environment variables in the unit file or shell`);
          }
          info('Run: profclaw daemon start');
        } else {
          warn(`Unsupported platform: ${PLATFORM}. Only macOS and Linux supported.`);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Install failed');
        process.exit(1);
      }
    });

  cmd
    .command('uninstall')
    .description('Remove the system service')
    .action(() => {
      try {
        if (PLATFORM === 'darwin') {
          if (fs.existsSync(PLIST_PATH)) {
            spawnSync('launchctl', ['unload', PLIST_PATH], { stdio: 'inherit' });
            fs.unlinkSync(PLIST_PATH);
            success('launchd service uninstalled');
          } else {
            info('Service not installed.');
          }
        } else if (PLATFORM === 'linux') {
          if (fs.existsSync(SYSTEMD_PATH)) {
            spawnSync('systemctl', ['--user', 'disable', '--now', 'profclaw'], { stdio: 'inherit' });
            fs.unlinkSync(SYSTEMD_PATH);
            spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
            success('systemd service uninstalled');
          } else {
            info('Service not installed.');
          }
        } else {
          warn(`Unsupported platform: ${PLATFORM}`);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Uninstall failed');
        process.exit(1);
      }
    });

  cmd
    .command('start')
    .description('Start the service')
    .action(() => {
      try {
        // Rotate logs before starting
        rotateLogs();

        if (PLATFORM === 'darwin') {
          if (!fs.existsSync(PLIST_PATH)) {
            error('Service not installed. Run: profclaw daemon install');
            process.exit(1);
          }
          spawnSync('launchctl', ['load', '-w', PLIST_PATH], { stdio: 'inherit' });
          success('Service started');
          info(`Logs: ${path.join(LOG_DIR, 'daemon.log')}`);
        } else if (PLATFORM === 'linux') {
          if (!fs.existsSync(SYSTEMD_PATH)) {
            error('Service not installed. Run: profclaw daemon install');
            process.exit(1);
          }
          spawnSync('systemctl', ['--user', 'start', 'profclaw'], { stdio: 'inherit' });
          success('Service started');
          info('Logs: journalctl --user -u profclaw -f');
        } else {
          warn(`Unsupported platform: ${PLATFORM}`);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Start failed');
        process.exit(1);
      }
    });

  cmd
    .command('stop')
    .description('Stop the service')
    .action(() => {
      try {
        if (PLATFORM === 'darwin') {
          spawnSync('launchctl', ['unload', PLIST_PATH], { stdio: 'inherit' });
          success('Service stopped');
        } else if (PLATFORM === 'linux') {
          spawnSync('systemctl', ['--user', 'stop', 'profclaw'], { stdio: 'inherit' });
          success('Service stopped');
        } else {
          warn(`Unsupported platform: ${PLATFORM}`);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Stop failed');
        process.exit(1);
      }
    });

  cmd
    .command('restart')
    .description('Restart the service')
    .action(() => {
      try {
        rotateLogs();
        if (PLATFORM === 'darwin') {
          spawnSync('launchctl', ['unload', PLIST_PATH], { stdio: 'inherit' });
          spawnSync('launchctl', ['load', '-w', PLIST_PATH], { stdio: 'inherit' });
          success('Service restarted');
        } else if (PLATFORM === 'linux') {
          spawnSync('systemctl', ['--user', 'restart', 'profclaw'], { stdio: 'inherit' });
          success('Service restarted');
        } else {
          warn(`Unsupported platform: ${PLATFORM}`);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Restart failed');
        process.exit(1);
      }
    });

  cmd
    .command('status')
    .description('Show service status')
    .action(() => {
      try {
        if (PLATFORM === 'darwin') {
          const installed = fs.existsSync(PLIST_PATH);
          console.log(`  Installed: ${installed ? chalk.green('yes') : chalk.dim('no')}`);
          if (installed) {
            const out = spawnSync('launchctl', ['list', PLIST_LABEL], { encoding: 'utf8' });
            const running = out.status === 0;
            console.log(`  Running:   ${running ? chalk.green('yes') : chalk.red('no')}`);
            // Show PID if running
            if (running && out.stdout) {
              const pidMatch = out.stdout.match(/"PID"\s*=\s*(\d+)/);
              if (pidMatch) {
                console.log(`  PID:       ${pidMatch[1]}`);
              }
            }
            // Show log file sizes
            const logFile = path.join(LOG_DIR, 'daemon.log');
            const errFile = path.join(LOG_DIR, 'daemon-error.log');
            if (fs.existsSync(logFile)) {
              const size = fs.statSync(logFile).size;
              console.log(`  Log size:  ${Math.round(size / 1024)}KB`);
            }
            if (fs.existsSync(errFile)) {
              const size = fs.statSync(errFile).size;
              if (size > 0) {
                console.log(`  Errors:    ${Math.round(size / 1024)}KB ${chalk.yellow('(check: profclaw daemon logs)')}`);
              }
            }
          }
        } else if (PLATFORM === 'linux') {
          spawnSync('systemctl', ['--user', 'status', 'profclaw'], { stdio: 'inherit' });
        } else {
          warn(`Unsupported platform: ${PLATFORM}`);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Status check failed');
        process.exit(1);
      }
    });

  cmd
    .command('logs')
    .description('Show service logs')
    .option('-f, --follow', 'Follow log output')
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .option('--errors', 'Show error log only')
    .action((options: { follow?: boolean; lines: string; errors?: boolean }) => {
      try {
        if (PLATFORM === 'darwin') {
          const logFile = options.errors
            ? path.join(LOG_DIR, 'daemon-error.log')
            : path.join(LOG_DIR, 'daemon.log');
          if (!fs.existsSync(logFile)) {
            info('No log file found. Is the daemon installed?');
            return;
          }
          const args = options.follow
            ? ['-f', '-n', options.lines, logFile]
            : ['-n', options.lines, logFile];
          spawnSync('tail', args, { stdio: 'inherit' });
        } else if (PLATFORM === 'linux') {
          const args = ['--user', '-u', 'profclaw', '--no-pager', `-n${options.lines}`];
          if (options.follow) args.push('-f');
          if (options.errors) args.push('-p', 'err');
          spawnSync('journalctl', args, { stdio: 'inherit' });
        } else {
          warn(`Unsupported platform: ${PLATFORM}`);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to show logs');
        process.exit(1);
      }
    });

  cmd
    .command('rotate')
    .description('Rotate log files (macOS only)')
    .action(() => {
      if (PLATFORM === 'darwin') {
        rotateLogs();
        success('Log rotation complete');
      } else {
        info('Log rotation is handled by journald on Linux');
      }
    });

  return cmd;
}
