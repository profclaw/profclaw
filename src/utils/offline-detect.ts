/**
 * Offline Detection Utility
 *
 * Periodically pings the server health endpoint to detect connectivity.
 * Emits status-change notifications to registered listeners.
 * Queues commands locally while offline and replays them on reconnect.
 */

const DEFAULT_INTERVAL_MS = 10_000;
const HEALTH_PATH = '/health';
const PING_TIMEOUT_MS = 5_000;

export type OfflineStatusListener = (online: boolean) => void;

export interface QueuedCommand {
  id: string;
  payload: unknown;
  queuedAt: number;
}

export class OfflineDetector {
  private isOnline: boolean = true;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<OfflineStatusListener> = [];
  private serverUrl: string = '';
  private commandQueue: QueuedCommand[] = [];

  /**
   * Start polling `serverUrl + /health` every `intervalMs` milliseconds.
   * Defaults to 10 seconds.
   */
  start(serverUrl: string, intervalMs: number = DEFAULT_INTERVAL_MS): void {
    this.serverUrl = serverUrl;
    this.stop(); // clear any existing interval

    // Run an immediate check, then repeat on the interval
    void this.check();
    this.checkInterval = setInterval(() => { void this.check(); }, intervalMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.checkInterval !== null) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Register a listener that is called whenever the online status changes.
   * Returns an unsubscribe function.
   */
  onStatusChange(cb: OfflineStatusListener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  /** Returns the current online status. */
  getStatus(): boolean {
    return this.isOnline;
  }

  /**
   * Queue a command for later replay when the server comes back online.
   * Returns the queued command's id.
   */
  queueCommand(payload: unknown): string {
    const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.commandQueue.push({ id, payload, queuedAt: Date.now() });
    return id;
  }

  /**
   * Drain and return all queued commands in FIFO order.
   * The queue is cleared after calling this.
   */
  drainQueue(): QueuedCommand[] {
    const drained = [...this.commandQueue];
    this.commandQueue = [];
    return drained;
  }

  /** How many commands are currently queued. */
  queueLength(): number {
    return this.commandQueue.length;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async check(): Promise<void> {
    const wasOnline = this.isOnline;
    const nowOnline = await this.ping();

    if (nowOnline !== wasOnline) {
      this.isOnline = nowOnline;
      this.emit(nowOnline);
    }
  }

  private async ping(): Promise<boolean> {
    const url = `${this.serverUrl}${HEALTH_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private emit(online: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(online);
      } catch {
        // Swallow listener errors to keep the detector running
      }
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

let _instance: OfflineDetector | null = null;

/**
 * Returns the shared singleton OfflineDetector.
 * Lazily created on first call.
 */
export function getOfflineDetector(): OfflineDetector {
  if (_instance === null) {
    _instance = new OfflineDetector();
  }
  return _instance;
}
