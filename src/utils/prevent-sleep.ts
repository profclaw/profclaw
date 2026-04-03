/**
 * Sleep Prevention Utility
 *
 * Prevents OS sleep/screensaver during long agent runs.
 * - macOS: uses `caffeinate -i -w {pid}`
 * - Linux: tries `systemd-inhibit` then falls back to `xdg-screensaver suspend`
 * - Windows: no-op (PowerShell SetThreadExecutionState not exposed without ffi)
 */

import { spawn, type ChildProcess } from 'child_process';

let _instance: SleepPreventer | null = null;

export class SleepPreventer {
  private _process: ChildProcess | null = null;
  private _active = false;

  /**
   * Start preventing OS sleep.
   * Safe to call multiple times — subsequent calls are no-ops if already active.
   */
  start(): void {
    if (this._active) return;

    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        this._process = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
          detached: false,
          stdio: 'ignore',
        });
        this._process.unref();
        this._active = true;
      } else if (platform === 'linux') {
        // Try systemd-inhibit first; it works on most modern distros
        this._process = spawn(
          'systemd-inhibit',
          [
            '--what=sleep:idle',
            '--who=profClaw',
            '--why=Agent run in progress',
            '--mode=block',
            'sleep', 'infinity',
          ],
          { detached: false, stdio: 'ignore' }
        );
        this._process.unref();

        this._process.on('error', () => {
          // systemd-inhibit unavailable — try xdg-screensaver
          this._process = null;
          try {
            const p = spawn('xdg-screensaver', ['suspend', String(process.pid)], {
              detached: false,
              stdio: 'ignore',
            });
            p.unref();
            this._process = p;
          } catch {
            // xdg-screensaver also unavailable — silent no-op
          }
        });

        this._active = true;
      }
      // Windows / unknown: no-op — _active stays false
    } catch {
      // If spawn itself throws, treat as silent failure
      this._process = null;
    }
  }

  /**
   * Stop preventing sleep and release the system process.
   */
  stop(): void {
    if (!this._active) return;

    if (this._process) {
      try {
        this._process.kill();
      } catch {
        // Already dead — ignore
      }
      this._process = null;
    }

    this._active = false;
  }

  isActive(): boolean {
    return this._active;
  }
}

/**
 * Returns the shared singleton SleepPreventer instance.
 */
export function getSleepPreventer(): SleepPreventer {
  if (!_instance) {
    _instance = new SleepPreventer();
  }
  return _instance;
}
