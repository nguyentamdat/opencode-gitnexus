/**
 * Error types for better error handling and recovery
 * Inspired by omo project patterns
 */

export class GitNexusError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = "GitNexusError";
  }
}

export class NetworkError extends GitNexusError {
  constructor(
    message: string,
    public override readonly cause?: Error
  ) {
    super(message, "NETWORK_ERROR", true);
    this.name = "NetworkError";
  }
}

export class NPMRegistryError extends GitNexusError {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message, "NPM_REGISTRY_ERROR", true);
    this.name = "NPMRegistryError";
  }
}

export class FileSystemError extends GitNexusError {
  constructor(
    message: string,
    public readonly path: string,
    public override readonly cause?: Error
  ) {
    super(message, "FILESYSTEM_ERROR", false);
    this.name = "FileSystemError";
  }
}

export class AnalysisError extends GitNexusError {
  constructor(
    message: string,
    public readonly taskId: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message, "ANALYSIS_ERROR", false);
    this.name = "AnalysisError";
  }
}

export class SpawnError extends GitNexusError {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr?: string
  ) {
    super(message, "SPAWN_ERROR", true);
    this.name = "SpawnError";
  }
}

// Error classification helper
export function classifyError(error: unknown): GitNexusError {
  if (error instanceof GitNexusError) {
    return error;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();

  // Network-related errors
  if (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("abort")
  ) {
    return new NetworkError(err.message, err);
  }

  // File system errors
  if (
    message.includes("enoent") ||
    message.includes("eacces") ||
    message.includes("eperm") ||
    message.includes("not found") ||
    message.includes("permission")
  ) {
    return new FileSystemError(err.message, "", err);
  }

  // Default to non-recoverable error
  return new GitNexusError(err.message, "UNKNOWN_ERROR", false);
}

// Safe wrapper for operations
export async function safeAsync<T>(
  operation: () => Promise<T>,
  defaultValue: T,
  onError?: (error: GitNexusError) => void
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const classified = classifyError(error);
    onError?.(classified);
    return defaultValue;
  }
}

// Safe sync wrapper
export function safeSync<T>(operation: () => T, defaultValue: T, onError?: (error: GitNexusError) => void): T {
  try {
    return operation();
  } catch (error) {
    const classified = classifyError(error);
    onError?.(classified);
    return defaultValue;
  }
}
