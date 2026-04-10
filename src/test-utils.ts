/**
 * Test utilities and mock implementations for opencode-gitnexus
 * Provides a mock logger compatible with the ILogger interface
 */

import type { ILogger, LogLevel, LogEntry } from "./logger.js";

/**
 * Mock logger that captures log entries for testing
 */
export class MockLogger implements ILogger {
  public entries: LogEntry[] = [];
  private minLevel: LogLevel = "debug";
  private levelValues: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(options?: { minLevel?: LogLevel }) {
    this.minLevel = options?.minLevel ?? "debug";
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelValues[level] >= this.levelValues[this.minLevel];
  }

  private addEntry(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) return;

    this.entries.push({
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
    });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.addEntry("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.addEntry("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.addEntry("warn", message, context, error);
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.addEntry("error", message, context, error);
  }

  /**
   * Get all entries of a specific level
   */
  getEntries(level?: LogLevel): LogEntry[] {
    if (!level) return [...this.entries];
    return this.entries.filter((e) => e.level === level);
  }

  /**
   * Check if any entry contains a message
   */
  hasMessage(partial: string): boolean {
    return this.entries.some((e) => e.message.toLowerCase().includes(partial.toLowerCase()));
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get the last entry
   */
  get lastEntry(): LogEntry | undefined {
    return this.entries[this.entries.length - 1];
  }
}

/**
 * No-op logger for when logging is disabled
 */
export class NoOpLogger implements ILogger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
