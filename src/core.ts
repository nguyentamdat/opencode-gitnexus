import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { getDirSizeMB, runCommandWithOutput } from "./spawn.js";

const require = createRequire(import.meta.url);

export interface AnalysisTask {
  taskId: string;
  dir: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export const DEFAULT_MCP_COMMAND = ["npx", "-y", "gitnexus", "mcp"];
export const DEFAULT_MAX_SIZE_MB = 100;

export const analysisTasks = new Map<string, AnalysisTask>();

export function isSourceCodeRepo(dir: string): boolean {
  const indicators = [
    ".git",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "CMakeLists.txt",
    "requirements.txt",
    "pyproject.toml",
    "Gemfile",
    "composer.json",
    "*.csproj",
    "*.sln",
  ];

  for (const indicator of indicators) {
    if (indicator.startsWith("*.")) {
      const ext = indicator.slice(1);
      try {
        const files = require("node:fs").readdirSync(dir);
        if (files.some((f: string) => f.endsWith(ext))) return true;
      } catch {
        continue;
      }
    } else if (existsSync(join(dir, indicator))) {
      return true;
    }
  }

  return false;
}

export async function runAnalysisInBackground(
  task: AnalysisTask,
  log: (level: string, message: string) => void,
): Promise<void> {
  log("INFO", `Analysis started: ${task.taskId} for ${task.dir}`);

  try {
    const result = await runCommandWithOutput("npx", ["-y", "gitnexus", "analyze"], {
      cwd: task.dir,
      timeout: 300000,
    });

    if (result.exitCode === 0) {
      task.status = "completed";
      task.completedAt = new Date().toISOString();
      log("INFO", `Analysis complete: ${task.taskId}`);
    } else {
      task.status = "failed";
      task.error = `Exit code: ${result.exitCode}, stderr: ${result.stderr}`;
      task.completedAt = new Date().toISOString();
      log("INFO", `Analysis failed: ${task.taskId} (exit ${result.exitCode})`);
    }
  } catch (error) {
    task.status = "failed";
    task.error = String(error);
    task.completedAt = new Date().toISOString();
    log("ERROR", `Analysis error: ${task.taskId} (${error})`);
  }
}

export async function autoAnalyzeRepo(
  dir: string,
  maxSizeMB: number,
  log: (level: string, message: string) => void,
): Promise<string | null> {
  const gitnexusDir = join(dir, ".gitnexus");

  if (existsSync(gitnexusDir)) return null;
  if (!isSourceCodeRepo(dir)) return null;

  const sizeMB = await getDirSizeMB(dir);
  if (sizeMB > maxSizeMB) {
    log("INFO", `Repo too large (${sizeMB}MB > ${maxSizeMB}MB), skipping: ${dir}`);
    return null;
  }

  log("INFO", `Auto-analyzing repo: ${dir} (${sizeMB}MB)`);

  const taskId = `gitnexus-analyze-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const task: AnalysisTask = {
    taskId,
    dir,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  analysisTasks.set(taskId, task);
  runAnalysisInBackground(task, log);
  return taskId;
}

export const GITNEXUS_PROTOCOL = `IMPORTANT — GitNexus Integration Protocol:
1. GitNexus provides code intelligence tools (query, context, impact) for understanding repositories.
2. The plugin auto-analyzes source code repos when opened. Analysis status is shown in the system prompt.
3. Prefer GitNexus tools for understanding code structure, dependencies, and impact analysis.
4. Before making significant code changes, check impact with GitNexus to understand what might break.

Helpful usage:
- gitnexus_query: Search codebase with natural language
- gitnexus_context: Get context about specific code locations
- gitnexus_impact: Analyze impact of proposed changes

This protocol keeps code work grounded in repository intelligence.`;

export const SESSION_START_INSTRUCTION = `[SYSTEM — GitNexus Context Load]
On session start, load GitNexus context by calling this tool directly:

1. mcp_gitnexus_list_repos() — check which repos are indexed

If repos are indexed, use GitNexus tools (query, context, impact) for code understanding.
If no repos indexed, skip silently — GitNexus will auto-analyze when a source code repo is opened.
Proceed with the user's request immediately.
<!-- GITNEXUS -->`;
