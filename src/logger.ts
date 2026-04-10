/**
 * Structured logging provider inspired by omo project patterns
 * Provides pluggable log sinks with consistent JSON formatting
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LogSink {
  write(entry: LogEntry): void | Promise<void>;
  close?(): void | Promise<void>;
}

export class FileLogSink implements LogSink {
  private fd: number | null = null;
  private buffer: string[] = [];
  private flushInterval: Timer | null = null;
  private maxBufferSize = 100;

  constructor(private filePath: string) {
    this.ensureFile();
    this.startFlushInterval();
  }

  private ensureFile(): void {
    try {
      const fs = require("node:fs");
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, "", { flag: "a" });
      }
      this.fd = fs.openSync(this.filePath, "a");
    } catch {
      // Silent failure - logging is best-effort
    }
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => this.flush(), 1000);
    // Don't keep process alive for logging
    if (this.flushInterval.unref) {
      this.flushInterval.unref();
    }
  }

  write(entry: LogEntry): void {
    // If file isn't open, don't accumulate logs in memory
    if (this.fd === null) return;

    try {
      const line = JSON.stringify(entry) + "\n";
      this.buffer.push(line);
      if (this.buffer.length >= this.maxBufferSize) {
        this.flush();
      }
    } catch {
      // Silent failure - logging is best-effort
    }
  }

  private flush(): void {
    if (this.buffer.length === 0 || this.fd === null) return;

    try {
      const fs = require("node:fs");
      fs.writeSync(this.fd, this.buffer.join(""));
    } catch {
      // Silent failure - logging is best-effort
      // Fall through to clear buffer to prevent memory growth
    }
    // Always clear buffer to prevent unbounded growth, even on write failure
    this.buffer.length = 0;
  }

  close(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
    if (this.fd !== null) {
      try {
        const fs = require("node:fs");
        fs.closeSync(this.fd);
      } catch {
        // Ignore close errors
      }
    }
  }
}

export class ConsoleLogSink implements LogSink {
  write(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}]`;

    if (entry.level === "error") {
      console.error(prefix, entry.message, entry.context ?? "");
    } else if (entry.level === "warn") {
      console.warn(prefix, entry.message, entry.context ?? "");
    } else {
      console.log(prefix, entry.message, entry.context ?? "");
    }
  }
}

export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>, error?: Error): void;
  error(message: string, context?: Record<string, unknown>, error?: Error): void;
  close?(): void;
}

export class Logger implements ILogger {
  private sinks: LogSink[] = [];
  private minLevel: LogLevel = "info";
  private levelValues: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(options?: { minLevel?: LogLevel; sinks?: LogSink[] }) {
    this.minLevel = options?.minLevel ?? "info";
    if (options?.sinks) {
      this.sinks = options.sinks;
    }
  }

  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelValues[level] >= this.levelValues[this.minLevel];
  }

  private createEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : undefined,
    };
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    if (!this.shouldLog(level)) return;

    const entry = this.createEntry(level, message, context, error);

    for (const sink of this.sinks) {
      try {
        sink.write(entry);
      } catch {
        // Silent failure - logging is best-effort
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log("warn", message, context, error);
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log("error", message, context, error);
  }

  close(): void {
    for (const sink of this.sinks) {
      try {
        sink.close?.();
      } catch {
        // Ignore close errors
      }
    }
    this.sinks = [];
  }
}

// Factory function for creating production logger
export function createLogger(filePath: string): Logger {
  const logger = new Logger({
    minLevel: process.env.GITNEXUS_DEBUG ? "debug" : "info",
  });

  // Add file sink for production logging
  logger.addSink(new FileLogSink(filePath));

  // Add console sink in debug mode
  if (process.env.GITNEXUS_DEBUG) {
    logger.addSink(new ConsoleLogSink());
  }

  return logger;
}
