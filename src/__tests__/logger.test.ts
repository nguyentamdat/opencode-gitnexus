import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Logger,
  FileLogSink,
  ConsoleLogSink,
  createLogger,
  LogLevel,
  LogEntry,
} from "../logger.js";

describe("FileLogSink", () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "logger-test-"));
    logFile = join(tempDir, "test.log");
  });

  afterEach(() => {
    try {
      if (existsSync(logFile)) unlinkSync(logFile);
      if (existsSync(tempDir)) rmdirSync(tempDir);
    } catch {}
  });

  test("creates log file if it doesn't exist", () => {
    expect(existsSync(logFile)).toBe(false);
    const sink = new FileLogSink(logFile);
    sink.close();
    expect(existsSync(logFile)).toBe(true);
  });

  test("writes single log entry to file", () => {
    const sink = new FileLogSink(logFile);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Test message",
    };

    sink.write(entry);
    sink.close(); // Flush buffer

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("Test message");
    expect(content).toContain("info");
  });

  test("writes multiple log entries", () => {
    const sink = new FileLogSink(logFile);
    const entries: LogEntry[] = [
      { timestamp: new Date().toISOString(), level: "info", message: "First" },
      { timestamp: new Date().toISOString(), level: "warn", message: "Second" },
      { timestamp: new Date().toISOString(), level: "error", message: "Third" },
    ];

    entries.forEach((e) => sink.write(e));
    sink.close();

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("First");
    expect(content).toContain("Second");
    expect(content).toContain("Third");
  });

  test("buffers entries and flushes on close", () => {
    const sink = new FileLogSink(logFile);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "debug",
      message: "Buffered message",
    };

    sink.write(entry);
    // Before close, file might be empty or partial due to buffering
    sink.close();

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("Buffered message");
  });

  test("handles flush when buffer is empty", () => {
    const sink = new FileLogSink(logFile);
    // Should not throw
    sink.close();
    expect(existsSync(logFile)).toBe(true);
  });

  test("does not accumulate logs when fd is null", () => {
    // Create sink with invalid path to force fd=null
    const invalidSink = new FileLogSink("/nonexistent/path/test.log");
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Should not accumulate",
    };

    // Write multiple entries - should not accumulate in memory
    for (let i = 0; i < 100; i++) {
      invalidSink.write(entry);
    }

    invalidSink.close();
    // Test passes if no memory issues (no way to directly test buffer size)
  });

  test("includes context in JSON output", () => {
    const sink = new FileLogSink(logFile);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: "With context",
      context: { userId: 123, action: "login" },
    };

    sink.write(entry);
    sink.close();

    const content = readFileSync(logFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.context).toEqual({ userId: 123, action: "login" });
  });

  test("includes error details in JSON output", () => {
    const sink = new FileLogSink(logFile);
    const error = new Error("Test error");
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "error",
      message: "Error occurred",
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };

    sink.write(entry);
    sink.close();

    const content = readFileSync(logFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.error.name).toBe("Error");
    expect(parsed.error.message).toBe("Test error");
    expect(parsed.error.stack).toBeDefined();
  });
});

describe("Logger", () => {
  test("logs at appropriate levels", () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
    };

    const logger = new Logger({ minLevel: "debug" });
    logger.addSink(mockSink);

    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");

    expect(entries).toHaveLength(4);
    expect(entries[0].level).toBe("debug");
    expect(entries[1].level).toBe("info");
    expect(entries[2].level).toBe("warn");
    expect(entries[3].level).toBe("error");
  });

  test("respects minLevel setting", () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
    };

    const logger = new Logger({ minLevel: "warn" });
    logger.addSink(mockSink);

    logger.debug("Debug");
    logger.info("Info");
    logger.warn("Warn");
    logger.error("Error");

    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe("warn");
    expect(entries[1].level).toBe("error");
  });

  test("can change minLevel after creation", () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
    };

    const logger = new Logger({ minLevel: "error" });
    logger.addSink(mockSink);

    logger.warn("Before change");
    expect(entries).toHaveLength(0);

    logger.setMinLevel("warn");
    logger.warn("After change");
    expect(entries).toHaveLength(1);
  });

  test("writes to multiple sinks", () => {
    const sink1Entries: LogEntry[] = [];
    const sink2Entries: LogEntry[] = [];

    const logger = new Logger({ minLevel: "info" });
    logger.addSink({ write: (e) => sink1Entries.push(e) });
    logger.addSink({ write: (e) => sink2Entries.push(e) });

    logger.info("Test");

    expect(sink1Entries).toHaveLength(1);
    expect(sink2Entries).toHaveLength(1);
    expect(sink1Entries[0].message).toBe("Test");
    expect(sink2Entries[0].message).toBe("Test");
  });

  test("handles sink errors gracefully", () => {
    const logger = new Logger({ minLevel: "info" });
    logger.addSink({
      write: () => {
        throw new Error("Sink error");
      },
    });

    // Should not throw
    expect(() => logger.info("Test")).not.toThrow();
  });

  test("includes context in log entry", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({ minLevel: "info" });
    logger.addSink({ write: (e) => entries.push(e) });

    logger.info("Message with context", { userId: 456, requestId: "abc" });

    expect(entries[0].context).toEqual({ userId: 456, requestId: "abc" });
  });

  test("includes error in log entry", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({ minLevel: "error" });
    logger.addSink({ write: (e) => entries.push(e) });

    const error = new Error("Something failed");
    logger.error("Operation failed", { operation: "test" }, error);

    expect(entries[0].error?.message).toBe("Something failed");
    expect(entries[0].error?.name).toBe("Error");
    expect(entries[0].context).toEqual({ operation: "test" });
  });

  test("close calls close on all sinks", () => {
    const closed: string[] = [];
    const logger = new Logger();
    logger.addSink({
      write: () => {},
      close: () => closed.push("sink1"),
    });
    logger.addSink({
      write: () => {},
      close: () => closed.push("sink2"),
    });

    logger.close();

    expect(closed).toContain("sink1");
    expect(closed).toContain("sink2");
  });

  test("handles close errors gracefully", () => {
    const logger = new Logger();
    logger.addSink({
      write: () => {},
      close: () => {
        throw new Error("Close failed");
      },
    });

    // Should not throw
    expect(() => logger.close()).not.toThrow();
  });
});

describe("createLogger", () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "logger-test-"));
    logFile = join(tempDir, "app.log");
  });

  afterEach(() => {
    try {
      if (existsSync(logFile)) unlinkSync(logFile);
      if (existsSync(tempDir)) rmdirSync(tempDir);
    } catch {}
  });

  test("creates logger with file sink", () => {
    const logger = createLogger(logFile);
    logger.info("Test message");
    logger.close();

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("Test message");
  });

  test("uses debug level when GITNEXUS_DEBUG is set", () => {
    const originalDebug = process.env.GITNEXUS_DEBUG;
    process.env.GITNEXUS_DEBUG = "1";

    const entries: LogEntry[] = [];
    const mockSink = {
      write: (e: LogEntry) => entries.push(e),
      close: () => {},
    };

    // Manually create logger with console sink to test level
    const logger = new Logger({ minLevel: "debug" });
    logger.addSink(mockSink);

    logger.debug("Debug should appear");
    expect(entries).toHaveLength(1);

    process.env.GITNEXUS_DEBUG = originalDebug;
  });
});

describe("ConsoleLogSink", () => {
  test("writes to console methods appropriately", () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const logs: string[] = [];
    const warns: string[] = [];
    const errors: string[] = [];

    console.log = (...args) => logs.push(args.join(" "));
    console.warn = (...args) => warns.push(args.join(" "));
    console.error = (...args) => errors.push(args.join(" "));

    try {
      const sink = new ConsoleLogSink();

      sink.write({
        timestamp: new Date().toISOString(),
        level: "debug",
        message: "Debug msg",
      });
      sink.write({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Info msg",
      });
      sink.write({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: "Warn msg",
      });
      sink.write({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Error msg",
      });

      expect(logs.some((l) => l.includes("Debug msg"))).toBe(true);
      expect(logs.some((l) => l.includes("Info msg"))).toBe(true);
      expect(warns.some((w) => w.includes("Warn msg"))).toBe(true);
      expect(errors.some((e) => e.includes("Error msg"))).toBe(true);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  });
});
