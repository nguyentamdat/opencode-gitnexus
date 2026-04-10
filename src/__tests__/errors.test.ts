import { describe, test, expect } from "bun:test";
import {
  GitNexusError,
  NetworkError,
  NPMRegistryError,
  FileSystemError,
  AnalysisError,
  SpawnError,
  classifyError,
  safeAsync,
  safeSync,
} from "../errors.js";

describe("GitNexusError", () => {
  test("creates error with code and recoverable flag", () => {
    const error = new GitNexusError("Something went wrong", "TEST_ERROR", true);

    expect(error.message).toBe("Something went wrong");
    expect(error.code).toBe("TEST_ERROR");
    expect(error.recoverable).toBe(true);
    expect(error.name).toBe("GitNexusError");
  });

  test("defaults to non-recoverable", () => {
    const error = new GitNexusError("Fatal", "FATAL_ERROR");
    expect(error.recoverable).toBe(false);
  });
});

describe("NetworkError", () => {
  test("creates recoverable network error with cause", () => {
    const cause = new Error("Connection refused");
    const error = new NetworkError("Failed to connect", cause);

    expect(error.message).toBe("Failed to connect");
    expect(error.cause).toBe(cause);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.recoverable).toBe(true);
    expect(error.name).toBe("NetworkError");
  });

  test("works without cause", () => {
    const error = new NetworkError("Timeout");
    expect(error.cause).toBeUndefined();
  });
});

describe("NPMRegistryError", () => {
  test("creates error with status code", () => {
    const error = new NPMRegistryError("Registry unavailable", 503);

    expect(error.message).toBe("Registry unavailable");
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe("NPM_REGISTRY_ERROR");
    expect(error.recoverable).toBe(true);
    expect(error.name).toBe("NPMRegistryError");
  });

  test("works without status code", () => {
    const error = new NPMRegistryError("Unknown error");
    expect(error.statusCode).toBeUndefined();
  });
});

describe("FileSystemError", () => {
  test("creates error with path and cause", () => {
    const cause = new Error("Permission denied");
    const error = new FileSystemError("Cannot read file", "/path/to/file", cause);

    expect(error.message).toBe("Cannot read file");
    expect(error.path).toBe("/path/to/file");
    expect(error.cause).toBe(cause);
    expect(error.code).toBe("FILESYSTEM_ERROR");
    expect(error.recoverable).toBe(false);
    expect(error.name).toBe("FileSystemError");
  });

  test("works without cause", () => {
    const error = new FileSystemError("Not found", "/missing");
    expect(error.cause).toBeUndefined();
  });
});

describe("AnalysisError", () => {
  test("creates error with task details", () => {
    const error = new AnalysisError(
      "Analysis failed",
      "task-123",
      1,
      "stderr output"
    );

    expect(error.message).toBe("Analysis failed");
    expect(error.taskId).toBe("task-123");
    expect(error.exitCode).toBe(1);
    expect(error.stderr).toBe("stderr output");
    expect(error.code).toBe("ANALYSIS_ERROR");
    expect(error.recoverable).toBe(false);
    expect(error.name).toBe("AnalysisError");
  });

  test("works with minimal details", () => {
    const error = new AnalysisError("Failed", "task-456");
    expect(error.exitCode).toBeUndefined();
    expect(error.stderr).toBeUndefined();
  });
});

describe("SpawnError", () => {
  test("creates error with command details", () => {
    const error = new SpawnError("Command failed", "git", 1, "fatal: not a repo");

    expect(error.message).toBe("Command failed");
    expect(error.command).toBe("git");
    expect(error.exitCode).toBe(1);
    expect(error.stderr).toBe("fatal: not a repo");
    expect(error.code).toBe("SPAWN_ERROR");
    expect(error.recoverable).toBe(true);
    expect(error.name).toBe("SpawnError");
  });

  test("works without stderr", () => {
    const error = new SpawnError("Killed", "npm", 137);
    expect(error.stderr).toBeUndefined();
  });
});

describe("classifyError", () => {
  test("returns existing GitNexusError as-is", () => {
    const original = new GitNexusError("Test", "TEST");
    const classified = classifyError(original);
    expect(classified).toBe(original);
  });

  test("classifies network-related errors", () => {
    const errors = [
      new Error("fetch failed"),
      new Error("network timeout"),
      new Error("ECONNREFUSED"),
      new Error("ENOTFOUND"),
      new Error("request aborted"),
    ];

    errors.forEach((err) => {
      const classified = classifyError(err);
      expect(classified).toBeInstanceOf(NetworkError);
      expect(classified.recoverable).toBe(true);
    });
  });

  test("classifies file system errors", () => {
    const errors = [
      new Error("ENOENT: no such file"),
      new Error("EACCES: permission denied"),
      new Error("EPERM: operation not permitted"),
      new Error("file not found"),
      new Error("permission denied"),
    ];

    errors.forEach((err) => {
      const classified = classifyError(err);
      expect(classified).toBeInstanceOf(FileSystemError);
      expect(classified.recoverable).toBe(false);
    });
  });

  test("classifies unknown errors as non-recoverable GitNexusError", () => {
    const error = new Error("Something random");
    const classified = classifyError(error);

    expect(classified).toBeInstanceOf(GitNexusError);
    expect(classified.code).toBe("UNKNOWN_ERROR");
    expect(classified.recoverable).toBe(false);
  });

  test("handles non-Error values", () => {
    const classified = classifyError("string error");
    expect(classified).toBeInstanceOf(GitNexusError);
    expect(classified.message).toBe("string error");
  });

  test("handles null/undefined", () => {
    const classifiedNull = classifyError(null);
    expect(classifiedNull).toBeInstanceOf(GitNexusError);

    const classifiedUndefined = classifyError(undefined);
    expect(classifiedUndefined).toBeInstanceOf(GitNexusError);
  });
});

describe("safeAsync", () => {
  test("returns operation result on success", async () => {
    const result = await safeAsync(async () => "success", "default");
    expect(result).toBe("success");
  });

  test("returns default on error", async () => {
    const result = await safeAsync(async () => {
      throw new Error("Failure");
    }, "default");
    expect(result).toBe("default");
  });

  test("calls onError callback with classified error", async () => {
    const errors: GitNexusError[] = [];
    await safeAsync(
      async () => {
        throw new Error("network timeout");
      },
      "default",
      (err) => errors.push(err)
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(NetworkError);
  });

  test("works with void return type", async () => {
    let called = false;
    await safeAsync(async () => {
      called = true;
    }, undefined);
    expect(called).toBe(true);
  });
});

describe("safeSync", () => {
  test("returns operation result on success", () => {
    const result = safeSync(() => "success", "default");
    expect(result).toBe("success");
  });

  test("returns default on error", () => {
    const result = safeSync(() => {
      throw new Error("Failure");
    }, "default");
    expect(result).toBe("default");
  });

  test("calls onError callback with classified error", () => {
    const errors: GitNexusError[] = [];
    safeSync(
      () => {
        throw new Error("ENOENT: file not found");
      },
      "default",
      (err) => errors.push(err)
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(FileSystemError);
  });

  test("works with complex types", () => {
    interface Data {
      value: number;
    }
    const defaultData: Data = { value: 0 };

    const result = safeSync<Data>(() => {
      throw new Error("Fail");
    }, defaultData);

    expect(result).toEqual({ value: 0 });
  });
});

describe("Error integration", () => {
  test("network errors are recoverable", () => {
    const error = new NetworkError("Timeout");
    expect(error.recoverable).toBe(true);
  });

  test("file system errors are non-recoverable", () => {
    const error = new FileSystemError("Not found", "/path");
    expect(error.recoverable).toBe(false);
  });

  test("safe wrappers prevent throwing", async () => {
    // These should not throw
    expect(async () => {
      await safeAsync(async () => {
        throw new Error("Async error");
      }, null);
    }).not.toThrow();

    expect(() => {
      safeSync(() => {
        throw new Error("Sync error");
      }, null);
    }).not.toThrow();
  });
});
