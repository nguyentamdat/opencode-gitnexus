import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _testing } from "../index.js";

const {
  isSourceCodeRepo,
  getDirSizeMB,
  autoAnalyzeRepo,
  runAnalysisInBackground,
  analysisTasks,
  GITNEXUS_PROTOCOL,
  SESSION_START_INSTRUCTION,
  DEFAULT_MCP_COMMAND,
  DEFAULT_MAX_SIZE_MB,
} = _testing;

// ─── Helpers ───────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "gitnexus-test-"));
}

/** Mock shell tagged template — returns a chainable thenable */
function createMockShell(exitCode = 0): any {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const result = Promise.resolve({ exitCode });
    const chain: Record<string, unknown> = {
      cwd: () => chain,
      quiet: () => chain,
      nothrow: () => chain,
      then: result.then.bind(result),
      catch: result.catch.bind(result),
    };
    return chain;
  };
}

/** Mock shell that throws */
function createThrowingShell(error: Error): any {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const result = Promise.reject(error);
    const chain: Record<string, unknown> = {
      cwd: () => chain,
      quiet: () => chain,
      nothrow: () => chain,
      then: result.then.bind(result),
      catch: result.catch.bind(result),
    };
    return chain;
  };
}

// ─── isSourceCodeRepo ──────────────────────────────────────

describe("isSourceCodeRepo", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns false for empty directory", () => {
    expect(isSourceCodeRepo(tmpDir)).toBe(false);
  });

  test("detects package.json (Node.js project)", () => {
    writeFileSync(join(tmpDir, "package.json"), "{}");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects Cargo.toml (Rust project)", () => {
    writeFileSync(join(tmpDir, "Cargo.toml"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects go.mod (Go project)", () => {
    writeFileSync(join(tmpDir, "go.mod"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects .git directory", () => {
    mkdirSync(join(tmpDir, ".git"));
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects pyproject.toml (Python project)", () => {
    writeFileSync(join(tmpDir, "pyproject.toml"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects requirements.txt (Python project)", () => {
    writeFileSync(join(tmpDir, "requirements.txt"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects pom.xml (Java/Maven project)", () => {
    writeFileSync(join(tmpDir, "pom.xml"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects build.gradle (Java/Gradle project)", () => {
    writeFileSync(join(tmpDir, "build.gradle"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects CMakeLists.txt (C/C++ project)", () => {
    writeFileSync(join(tmpDir, "CMakeLists.txt"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects Gemfile (Ruby project)", () => {
    writeFileSync(join(tmpDir, "Gemfile"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects composer.json (PHP project)", () => {
    writeFileSync(join(tmpDir, "composer.json"), "{}");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects *.csproj files (C# project)", () => {
    writeFileSync(join(tmpDir, "MyApp.csproj"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("detects *.sln files (.NET solution)", () => {
    writeFileSync(join(tmpDir, "MyApp.sln"), "");
    expect(isSourceCodeRepo(tmpDir)).toBe(true);
  });

  test("returns false for non-existent directory", () => {
    expect(isSourceCodeRepo("/tmp/definitely-does-not-exist-xyz")).toBe(false);
  });
});

// ─── getDirSizeMB ──────────────────────────────────────────

describe("getDirSizeMB", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns a number for a real directory", async () => {
    const size = await getDirSizeMB(tmpDir);
    expect(typeof size).toBe("number");
    expect(size).toBeGreaterThanOrEqual(0);
    expect(size).toBeLessThan(Infinity);
  });

  test("returns 0 for non-existent directory (du fails silently)", async () => {
    const size = await getDirSizeMB("/tmp/this-path-does-not-exist-at-all-xyz");
    // du errors → empty stdout → parseInt('' || '0') = 0
    expect(size).toBe(0);
  });
});

// ─── runAnalysisInBackground ───────────────────────────────

describe("runAnalysisInBackground", () => {
  test("sets status to completed on success (exit 0)", async () => {
    const task: any = {
      taskId: "test-task-1",
      dir: "/tmp",
      status: "running",
      startedAt: new Date().toISOString(),
    };
    const shell = createMockShell(0);

    await runAnalysisInBackground(task, shell);

    expect(task.status).toBe("completed");
    expect(task.completedAt).toBeDefined();
    expect(task.error).toBeUndefined();
  });

  test("sets status to failed on non-zero exit", async () => {
    const task: any = {
      taskId: "test-task-2",
      dir: "/tmp",
      status: "running",
      startedAt: new Date().toISOString(),
    };
    const shell = createMockShell(1);

    await runAnalysisInBackground(task, shell);

    expect(task.status).toBe("failed");
    expect(task.error).toBe("Exit code: 1");
    expect(task.completedAt).toBeDefined();
  });

  test("sets status to failed on shell error", async () => {
    const task: any = {
      taskId: "test-task-3",
      dir: "/tmp",
      status: "running",
      startedAt: new Date().toISOString(),
    };
    const shell = createThrowingShell(new Error("spawn failed"));

    await runAnalysisInBackground(task, shell);

    expect(task.status).toBe("failed");
    expect(task.error).toContain("spawn failed");
    expect(task.completedAt).toBeDefined();
  });
});

// ─── autoAnalyzeRepo ───────────────────────────────────────

describe("autoAnalyzeRepo", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    analysisTasks.clear();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    analysisTasks.clear();
  });

  test("returns null if .gitnexus already exists", async () => {
    mkdirSync(join(tmpDir, ".gitnexus"));
    writeFileSync(join(tmpDir, "package.json"), "{}");
    const result = await autoAnalyzeRepo(tmpDir, 100, createMockShell());
    expect(result).toBeNull();
  });

  test("returns null if not a source code repo", async () => {
    // tmpDir is empty → not a source code repo
    const result = await autoAnalyzeRepo(tmpDir, 100, createMockShell());
    expect(result).toBeNull();
  });

  test("returns null if repo exceeds size limit", async () => {
    writeFileSync(join(tmpDir, "package.json"), "{}");
    // Use 0 MB limit — any real dir is bigger
    const result = await autoAnalyzeRepo(tmpDir, 0, createMockShell());
    expect(result).toBeNull();
  });

  test("returns taskId and stores task for valid repo", async () => {
    writeFileSync(join(tmpDir, "package.json"), "{}");
    const shell = createMockShell(0);

    const taskId = await autoAnalyzeRepo(tmpDir, 500, shell);

    expect(taskId).not.toBeNull();
    expect(taskId).toMatch(/^gitnexus-analyze-/);
    expect(analysisTasks.has(taskId!)).toBe(true);

    const task = analysisTasks.get(taskId!);
    expect(task?.dir).toBe(tmpDir);
    expect(task?.status).toBe("running");
  });

  test("task gets updated to completed after analysis finishes", async () => {
    writeFileSync(join(tmpDir, "package.json"), "{}");
    const shell = createMockShell(0);

    const taskId = await autoAnalyzeRepo(tmpDir, 500, shell);
    expect(taskId).not.toBeNull();

    // Wait for the fire-and-forget to settle
    await Bun.sleep(50);

    const task = analysisTasks.get(taskId!);
    expect(task?.status).toBe("completed");
  });
});

// ─── Plugin function ───────────────────────────────────────

describe("gitNexusPlugin", () => {
  // Import the default export
  let gitNexusPlugin: typeof import("../index.js").default;

  beforeEach(async () => {
    const mod = await import("../index.js");
    gitNexusPlugin = mod.default;
  });

  test("returns object with expected hooks", async () => {
    const mockInput = {
      directory: "/tmp",
      $: createMockShell(0),
    };

    const result = await gitNexusPlugin(mockInput as any, {
      disableAutoUpdate: true,
      disableAutoAnalyze: true,
    });

    expect(result).toHaveProperty("config");
    expect(result).toHaveProperty(["experimental.chat.system.transform"]);
    expect(result).toHaveProperty(["chat.message"]);
  });

  test("config hook registers MCP server", async () => {
    const mockInput = {
      directory: "/tmp",
      $: createMockShell(0),
    };

    const result = await gitNexusPlugin(mockInput as any, {
      disableAutoUpdate: true,
      disableAutoAnalyze: true,
    });

    const config: any = { mcp: {} };
    await result.config!(config);

    expect(config.mcp.gitnexus).toBeDefined();
    expect(config.mcp.gitnexus.type).toBe("local");
    expect(config.mcp.gitnexus.command).toEqual(DEFAULT_MCP_COMMAND);
  });

  test("config hook uses custom MCP command", async () => {
    const mockInput = {
      directory: "/tmp",
      $: createMockShell(0),
    };

    const customCmd = ["node", "my-server.js"];
    const result = await gitNexusPlugin(mockInput as any, {
      disableAutoUpdate: true,
      disableAutoAnalyze: true,
      mcpCommand: customCmd,
    });

    const config: any = { mcp: {} };
    await result.config!(config);

    expect(config.mcp.gitnexus.command).toEqual(customCmd);
  });

  test("config hook skipped when disableMcp is true", async () => {
    const mockInput = {
      directory: "/tmp",
      $: createMockShell(0),
    };

    const result = await gitNexusPlugin(mockInput as any, {
      disableAutoUpdate: true,
      disableAutoAnalyze: true,
      disableMcp: true,
    });

    expect(result.config).toBeUndefined();
  });

  test("system.transform injects GITNEXUS_PROTOCOL", async () => {
    const mockInput = {
      directory: "/tmp",
      $: createMockShell(0),
    };

    const result = await gitNexusPlugin(mockInput as any, {
      disableAutoUpdate: true,
      disableAutoAnalyze: true,
    });

    const output = { system: [] as string[] };
    await (result as any)["experimental.chat.system.transform"](
      { sessionID: "test", model: "test" },
      output,
    );

    expect(output.system.length).toBeGreaterThan(0);
    expect(output.system.some((s: string) => s.includes("GitNexus Integration Protocol"))).toBe(
      true,
    );
  });

  test("system.transform skips protocol when disableProtocol is true", async () => {
    const mockInput = {
      directory: "/tmp",
      $: createMockShell(0),
    };

    const result = await gitNexusPlugin(mockInput as any, {
      disableAutoUpdate: true,
      disableAutoAnalyze: true,
      disableProtocol: true,
    });

    const output = { system: [] as string[] };
    await (result as any)["experimental.chat.system.transform"](
      { sessionID: "test", model: "test" },
      output,
    );

    expect(output.system.every((s: string) => !s.includes("GitNexus Integration Protocol"))).toBe(
      true,
    );
  });

  test("chat.message injects session start instruction on first message", async () => {
    const mockInput = {
      directory: "/tmp",
      $: createMockShell(0),
    };

    const result = await gitNexusPlugin(mockInput as any, {
      disableAutoUpdate: true,
      disableAutoAnalyze: true,
    });

    const output = {
      parts: [{ type: "text", text: "Hello user" }],
    };

    await (result as any)["chat.message"]({ sessionID: "session-1" }, output);

    expect(output.parts[0]!.text).toContain("[SYSTEM");
    expect(output.parts[0]!.text).toContain("Hello user");
  });

  test("chat.message only injects once per session", async () => {
    const mockInput = {
      directory: "/tmp",
      $: createMockShell(0),
    };

    const result = await gitNexusPlugin(mockInput as any, {
      disableAutoUpdate: true,
      disableAutoAnalyze: true,
    });

    const output1 = { parts: [{ type: "text", text: "First message" }] };
    const output2 = { parts: [{ type: "text", text: "Second message" }] };

    await (result as any)["chat.message"]({ sessionID: "session-2" }, output1);
    await (result as any)["chat.message"]({ sessionID: "session-2" }, output2);

    // First message gets injection
    expect(output1.parts[0]!.text).toContain("[SYSTEM");
    // Second message is unchanged
    expect(output2.parts[0]!.text).toBe("Second message");
  });

  test("chat.message injects for different sessions independently", async () => {
    const mockInput = {
      directory: "/tmp",
      $: createMockShell(0),
    };

    const result = await gitNexusPlugin(mockInput as any, {
      disableAutoUpdate: true,
      disableAutoAnalyze: true,
    });

    const output1 = { parts: [{ type: "text", text: "Session A" }] };
    const output2 = { parts: [{ type: "text", text: "Session B" }] };

    await (result as any)["chat.message"]({ sessionID: "session-a" }, output1);
    await (result as any)["chat.message"]({ sessionID: "session-b" }, output2);

    // Both get injection (different sessions)
    expect(output1.parts[0]!.text).toContain("[SYSTEM");
    expect(output2.parts[0]!.text).toContain("[SYSTEM");
  });
});

// ─── Constants ─────────────────────────────────────────────

describe("constants", () => {
  test("DEFAULT_MCP_COMMAND is valid", () => {
    expect(DEFAULT_MCP_COMMAND).toEqual(["npx", "-y", "gitnexus", "mcp"]);
  });

  test("DEFAULT_MAX_SIZE_MB is 100", () => {
    expect(DEFAULT_MAX_SIZE_MB).toBe(100);
  });

  test("GITNEXUS_PROTOCOL contains key content", () => {
    expect(GITNEXUS_PROTOCOL).toContain("GitNexus Integration Protocol");
    expect(GITNEXUS_PROTOCOL).toContain("gitnexus_query");
    expect(GITNEXUS_PROTOCOL).toContain("gitnexus_context");
    expect(GITNEXUS_PROTOCOL).toContain("gitnexus_impact");
  });

  test("SESSION_START_INSTRUCTION contains context load instruction", () => {
    expect(SESSION_START_INSTRUCTION).toContain("GitNexus Context Load");
    expect(SESSION_START_INSTRUCTION).toContain("mcp_gitnexus_list_repos");
  });
});
