import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  isSourceCodeRepo,
  analysisTasks,
  GITNEXUS_PROTOCOL,
  SESSION_START_INSTRUCTION,
  DEFAULT_MCP_COMMAND,
  DEFAULT_MAX_SIZE_MB,
} from "./core.js";
import type { ILogger } from "./logger.js";

// Re-export mock utilities for tests
export { MockLogger, NoOpLogger } from "./test-utils.js";

type ShellResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

type MockShell = (strings: TemplateStringsArray, ...values: unknown[]) => PromiseLike<ShellResult> & {
  cwd?: (dir: string) => unknown;
  quiet?: () => unknown;
  nothrow?: () => unknown;
};

export async function getDirSizeMB(dir: string, shell: MockShell): Promise<number> {
  const result = await shell(["du -sm ", ""] as unknown as TemplateStringsArray, dir);

  if (result.exitCode !== 0 || !result.stdout) {
    return Infinity;
  }

  const size = parseInt(result.stdout.split("\t")[0] || "0", 10);
  return Number.isNaN(size) ? Infinity : size;
}

export async function runAnalysisInBackground(
  task: {
    taskId: string;
    dir: string;
    status: "running" | "completed" | "failed";
    startedAt: string;
    completedAt?: string;
    error?: string;
  },
  shell: MockShell,
): Promise<void> {
  try {
    const result = await shell(["npx -y gitnexus analyze"] as unknown as TemplateStringsArray);

    if (result.exitCode === 0) {
      task.status = "completed";
      task.completedAt = new Date().toISOString();
      return;
    }

    task.status = "failed";
    task.error = result.stderr ? `Exit code: ${result.exitCode}, stderr: ${result.stderr}` : `Exit code: ${result.exitCode}`;
    task.completedAt = new Date().toISOString();
  } catch (error) {
    task.status = "failed";
    task.error = String(error);
    task.completedAt = new Date().toISOString();
  }
}

export async function autoAnalyzeRepo(
  dir: string,
  maxSizeMB: number,
  shell: MockShell,
  logger?: ILogger
): Promise<string | null> {
  if (existsSync(join(dir, ".gitnexus"))) return null;
  if (!isSourceCodeRepo(dir)) return null;

  const sizeMB = await getDirSizeMB(dir, shell);
  if (sizeMB > maxSizeMB) {
    logger?.info("Repo too large, skipping", { sizeMB, maxSizeMB, dir });
    return null;
  }

  logger?.info("Auto-analyzing repo", { dir, sizeMB });

  const taskId = `gitnexus-analyze-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const task = {
    taskId,
    dir,
    status: "running" as const,
    startedAt: new Date().toISOString(),
  };

  analysisTasks.set(taskId, task);
  void runAnalysisInBackground(task, shell);
  return taskId;
}

export const _testing = {
  isSourceCodeRepo,
  getDirSizeMB,
  autoAnalyzeRepo,
  runAnalysisInBackground,
  analysisTasks,
  GITNEXUS_PROTOCOL,
  SESSION_START_INSTRUCTION,
  DEFAULT_MCP_COMMAND,
  DEFAULT_MAX_SIZE_MB,
};
