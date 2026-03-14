/**
 * Structured Logging Utility
 * 
 * Provides structured logging with:
 * - Log levels (debug, info, warn, error)
 * - Correlation IDs for request tracing
 * - Contextual metadata
 * - JSON output for production
 * - Pretty output for development
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

const LOG_LEVEL_PRIORITY = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

const ERROR_BASE_KEYS = new Set(['name', 'message', 'stack']);

export interface LogContext {
  /** Correlation ID for request tracing */
  correlationId?: string;
  
  /** User ID if available */
  userId?: string;
  
  /** Task ID if applicable */
  taskId?: string;
  
  /** Additional metadata */
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    [key: string]: unknown;
  };
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  
  /** Enable pretty printing (for development) */
  pretty: boolean;
  
  /** Include timestamps */
  includeTimestamp: boolean;

  /** Output stream for log entries */
  stream: 'stdout' | 'stderr';
  
  /** Additional context to include in all logs */
  defaultContext?: LogContext;
}

function getErrorMetadata(error: Error): Record<string, unknown> {
  const rawError = error as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(rawError).filter(([key]) => !ERROR_BASE_KEYS.has(key))
  );
}

/**
 * Structured logger class
 */
export class Logger {
  private config: LoggerConfig;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO,
      pretty: process.env.NODE_ENV !== 'production',
      includeTimestamp: true,
      stream: 'stdout',
      ...config,
    };
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a warning
   */
  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log an error
   */
  error(message: string, errorOrContext?: Error | LogContext, context?: LogContext): void {
    let error: Error | undefined;
    let finalContext: LogContext | undefined;

    if (errorOrContext instanceof Error) {
      error = errorOrContext;
      finalContext = context;
    } else {
      finalContext = errorOrContext;
    }

    this.log(LogLevel.ERROR, message, finalContext, error);
  }

  /**
   * Create a child logger with additional default context
   */
  child(context: LogContext): Logger {
    return new Logger({
      ...this.config,
      defaultContext: {
        ...this.config.defaultContext,
        ...context,
      },
    });
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): void {
    // Check if this log level should be output
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.config.level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        ...this.config.defaultContext,
        ...context,
      },
    };

    // Add error information if present
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...getErrorMetadata(error),
      };
    }

    // Output based on configuration
    if (this.config.pretty) {
      this.prettyPrint(entry);
    } else {
      this.jsonPrint(entry);
    }
  }

  /**
   * Pretty print for development
   */
  private prettyPrint(entry: LogEntry): void {
    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[32m',  // Green
      [LogLevel.WARN]: '\x1b[33m',  // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';
    const color = colors[entry.level];

    let output = `${color}[${entry.level}]${reset}`;
    
    if (this.config.includeTimestamp) {
      output += ` ${entry.timestamp}`;
    }
    
    output += ` ${entry.message}`;

    // Add correlation ID prominently if present
    if (entry.context?.correlationId) {
      output += ` ${color}[${entry.context.correlationId}]${reset}`;
    }

    this.writeLine(output);

    // Print context
    if (entry.context && Object.keys(entry.context).length > 0) {
      const { correlationId: _correlationId, ...otherContext } = entry.context;
      if (Object.keys(otherContext).length > 0) {
        this.writeLine(`  Context: ${this.formatValue(otherContext)}`);
      }
    }

    // Print error details
    if (entry.error) {
      this.writeLine(`  ${color}Error:${reset} ${entry.error.message}`);
      if (entry.error.stack) {
        this.writeLine(`  Stack: ${entry.error.stack}`);
      }
    }
  }

  /**
   * JSON print for production
   */
  private jsonPrint(entry: LogEntry): void {
    this.writeLine(JSON.stringify(entry));
  }

  /**
   * Update logger configuration
   */
  setConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  private writeLine(message: string): void {
    const stream = this.config.stream === 'stderr' ? process.stderr : process.stdout;
    stream.write(`${message}\n`);
  }

  private formatValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Generate a correlation ID
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Async local storage for correlation context
 * Allows maintaining correlation ID across async operations
 */
import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationContext {
  correlationId: string;
  metadata?: Record<string, unknown>;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Run a function with correlation context
 */
export function withCorrelation<T>(
  correlationId: string,
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  return correlationStorage.run({ correlationId, metadata }, fn);
}

/**
 * Get current correlation ID from context
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

/**
 * Get current correlation metadata
 */
export function getCorrelationMetadata(): Record<string, unknown> | undefined {
  return correlationStorage.getStore()?.metadata;
}

/**
 * Create a logger that automatically includes correlation context
 */
export function createContextualLogger(name?: string, config?: Partial<LoggerConfig>): Logger {
  const baseContext: LogContext = name ? { component: name } : {};

  const contextualLogger = new Logger({ ...config, defaultContext: baseContext });

  const mergeContext = (context?: LogContext): LogContext => {
    const correlationId = getCorrelationId();
    const metadata = getCorrelationMetadata();
    return {
      ...context,
      correlationId: correlationId || context?.correlationId,
      ...metadata,
    };
  };

  contextualLogger.debug = (message, context) => {
    Logger.prototype.debug.call(contextualLogger, message, mergeContext(context));
  };

  contextualLogger.info = (message, context) => {
    Logger.prototype.info.call(contextualLogger, message, mergeContext(context));
  };

  contextualLogger.warn = (message, context) => {
    Logger.prototype.warn.call(contextualLogger, message, mergeContext(context));
  };

  contextualLogger.error = (message, errorOrContext, context) => {
    if (errorOrContext instanceof Error) {
      Logger.prototype.error.call(
        contextualLogger,
        message,
        errorOrContext,
        mergeContext(context),
      );
      return;
    }

    Logger.prototype.error.call(
      contextualLogger,
      message,
      mergeContext(errorOrContext),
      context,
    );
  };

  return contextualLogger;
}

/**
 * Performance timing utility
 */
export class PerformanceTimer {
  private startTime: number;
  private endTime?: number;
  private marks: Map<string, number> = new Map();

  constructor(private name: string, private logger: Logger = logger) {
    this.startTime = performance.now();
  }

  /**
   * Mark a checkpoint
   */
  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  /**
   * End timing and log
   */
  end(context?: LogContext): number {
    this.endTime = performance.now();
    const duration = this.endTime - this.startTime;

    const marks: Record<string, number> = {};
    for (const [name, time] of this.marks) {
      marks[name] = Number((time - this.startTime).toFixed(2));
    }

    this.logger.info(`Performance: ${this.name}`, {
      ...context,
      duration: Number(duration.toFixed(2)),
      marks: Object.keys(marks).length > 0 ? marks : undefined,
    });

    return duration;
  }
}
