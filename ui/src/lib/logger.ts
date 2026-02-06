/**
 * GLINR UI Structured Logger
 *
 * Provides consistent logging across the frontend with:
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - Pretty colored output
 * - Contextual objects
 */

const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;

export type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export class Logger {
  private level: LogLevel = 'INFO';

  constructor(options?: { level?: LogLevel }) {
    if (options?.level) {
      this.level = options.level;
    } else {
      // Auto-set level from URL param or localStorage for easier debugging
      if (typeof window !== 'undefined') {
        try {
          const params = new URLSearchParams(window.location.search);
          const levelParam = params.get('logLevel')?.toUpperCase() as LogLevel;
          if (levelParam && LOG_LEVEL_PRIORITY[levelParam] !== undefined) {
            this.level = levelParam;
          } else {
            const storedLevel = localStorage.getItem('glinr_log_level')?.toUpperCase() as LogLevel;
            if (storedLevel && LOG_LEVEL_PRIORITY[storedLevel] !== undefined) {
              this.level = storedLevel;
            }
          }
        } catch {
          // Ignore storage errors
        }
      }
    }
  }

  debug(message: string, ...args: unknown[]) {
    this.log('DEBUG', message, ...args);
  }

  info(message: string, ...args: unknown[]) {
    this.log('INFO', message, ...args);
  }

  warn(message: string, ...args: unknown[]) {
    this.log('WARN', message, ...args);
  }

  error(message: string, error?: Error | unknown, context?: unknown) {
    if (error instanceof Error) {
      this.log('ERROR', message, { error: { message: error.message, stack: error.stack }, ...context as object });
    } else {
      this.log('ERROR', message, error, context);
    }
  }

  private log(level: LogLevel, message: string, ...args: unknown[]) {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) return;

    const styles: Record<LogLevel, string> = {
      DEBUG: 'color: #888; font-weight: bold',
      INFO: 'color: #3b82f6; font-weight: bold', // Blue
      WARN: 'color: #f59e0b; font-weight: bold', // Amber
      ERROR: 'color: #ef4444; font-weight: bold', // Red
    };

    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // In production, we might want to send these to a logging service
    // For now, we use styled console logs
    console.log(
      `%c[${level}] %c${timestamp} %c${message}`,
      styles[level],
      'color: #6b7280',
      'color: inherit',
      ...args
    );
  }
}

export const logger = new Logger();
