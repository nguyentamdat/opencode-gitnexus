import type { Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { checkAndUpdate, type UpdateResult } from "./auto-update.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

interface GitNexusPluginOptions extends Record<string, unknown> {
  mcpCommand?: string[];
  disableMcp?: boolean;
  disableProtocol?: boolean;
  disableAutoUpdate?: boolean;
  disableAutoAnalyze?: boolean;
  autoAnalyzeMaxSizeMB?: number;
}

interface AnalysisTask {
  taskId: string;
  dir: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
}

const DEFAULT_MCP_COMMAND = ["gitnexus", "mcp"];
const DEFAULT_MAX_SIZE_MB = 100;

// Store active analysis tasks
const analysisTasks = new Map<string, AnalysisTask>();

function isSourceCodeRepo(dir: string): boolean {
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
    } else {
      if (existsSync(join(dir, indicator))) return true;
    }
  }
  return false;
}

async function getDirSizeMB(dir: string): Promise<number> {
  try {
    const proc = Bun.spawn({
      cmd: ["du", "-sm", dir],
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const size = parseInt(output.split("\t")[0] || "0", 10);
    return isNaN(size) ? Infinity : size;
  } catch {
    return Infinity;
  }
}

async function runAnalysisInBackground(
  dir: string,
  shell: PluginInput["$"],
): Promise<void> {
  const taskId = `gitnexus-analyze-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const task: AnalysisTask = {
    taskId,
    dir,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  analysisTasks.set(taskId, task);
  console.log(`[opencode-gitnexus] Analysis started: ${taskId} for ${dir}`);

  try {
    const result = await shell`gitnexus analyze`.cwd(dir).quiet().nothrow();

    if (result.exitCode === 0) {
      task.status = "completed";
      task.completedAt = new Date().toISOString();
      console.log(`[opencode-gitnexus] Analysis complete: ${taskId}`);
    } else {
      task.status = "failed";
      task.error = `Exit code: ${result.exitCode}`;
      task.completedAt = new Date().toISOString();
      console.log(`[opencode-gitnexus] Analysis failed: ${taskId} (exit ${result.exitCode})`);
    }
  } catch (error) {
    task.status = "failed";
    task.error = String(error);
    task.completedAt = new Date().toISOString();
    console.log(`[opencode-gitnexus] Analysis error: ${taskId} (${error})`);
  }
}

async function autoAnalyzeRepo(
  dir: string,
  maxSizeMB: number,
  shell: PluginInput["$"],
): Promise<string | null> {
  const gitnexusDir = join(dir, ".gitnexus");

  // Skip if already analyzed
  if (existsSync(gitnexusDir)) return null;

  // Skip if not a source code repo
  if (!isSourceCodeRepo(dir)) return null;

  // Check size limit
  const sizeMB = await getDirSizeMB(dir);
  if (sizeMB > maxSizeMB) {
    console.log(`[opencode-gitnexus] Repo too large (${sizeMB}MB > ${maxSizeMB}MB), skipping: ${dir}`);
    return null;
  }

  console.log(`[opencode-gitnexus] Auto-analyzing repo: ${dir} (${sizeMB}MB)`);

  // Start analysis in background
  const taskId = `gitnexus-analyze-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const task: AnalysisTask = {
    taskId,
    dir,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  analysisTasks.set(taskId, task);

  // Fire and forget - don't await
  runAnalysisInBackground(dir, shell).then(() => {
    // Task updated in the map by runAnalysisInBackground
  });

  return taskId;
}

const GITNEXUS_PROTOCOL = `IMPORTANT — GitNexus Integration Protocol:
1. GitNexus provides code intelligence tools (query, context, impact) for understanding repositories.
2. The plugin auto-analyzes source code repos when opened. Check analysis status with gitnexus_check_analysis.
3. Use background_output tool with the task_id to check status of ongoing analyses.
4. Prefer GitNexus tools for understanding code structure, dependencies, and impact analysis.
5. Before making significant code changes, check impact with GitNexus to understand what might break.

Helpful usage:
- gitnexus_query: Search codebase with natural language
- gitnexus_context: Get context about specific code locations
- gitnexus_impact: Analyze impact of proposed changes
- gitnexus_check_analysis: Check status of auto-analysis tasks

This protocol keeps code work grounded in repository intelligence.`;

const gitNexusPlugin: Plugin = async (input: PluginInput, options?: PluginOptions) => {
  const opts = (options ?? {}) as GitNexusPluginOptions;
  const mcpCommand = opts.mcpCommand ?? DEFAULT_MCP_COMMAND;
  const maxSizeMB = opts.autoAnalyzeMaxSizeMB ?? DEFAULT_MAX_SIZE_MB;

  let updateResult: UpdateResult | null = null;

  // Auto-update check
  if (!opts.disableAutoUpdate) {
    checkAndUpdate(async (cwd) => {
      try {
        const result = await input.$`bun install`.cwd(cwd).quiet().nothrow();
        return result.exitCode === 0;
      } catch {
        return false;
      }
    })
      .then((result) => {
        updateResult = result;
        if (result.updated) {
          console.log(`[opencode-gitnexus] Auto-updated: ${result.currentVersion} → ${result.latestVersion}. Restart to apply.`);
        } else if (result.error) {
          console.log(`[opencode-gitnexus] Update available: ${result.currentVersion} → ${result.latestVersion} (install failed: ${result.error})`);
        }
      })
      .catch(() => {});
  }

  // Auto-analyze current directory if enabled
  let currentAnalysisTaskId: string | null = null;
  if (!opts.disableAutoAnalyze && input.directory) {
    currentAnalysisTaskId = await autoAnalyzeRepo(input.directory, maxSizeMB, input.$);
    if (currentAnalysisTaskId) {
      console.log(`[opencode-gitnexus] Analysis task: ${currentAnalysisTaskId}`);
    }
  }

  return {
    config: opts.disableMcp
      ? undefined
      : async (config) => {
          if (!config.mcp) config.mcp = {};
          if (!config.mcp.gitnexus) {
            config.mcp.gitnexus = {
              type: "local" as const,
              command: mcpCommand,
            };
          }
        },



    "experimental.chat.system.transform": async (
      _input: { sessionID?: string; model: unknown },
      output: { system: string[] },
    ) => {
      if (!opts.disableProtocol) {
        output.system.push(GITNEXUS_PROTOCOL);
      }

      if (updateResult?.updated) {
        output.system.push(`[opencode-gitnexus] Updated ${updateResult.currentVersion} → ${updateResult.latestVersion}. Restart OpenCode to apply.`);
      }

      if (currentAnalysisTaskId) {
        output.system.push(`[opencode-gitnexus] Auto-analyzing current repo. Check status with: gitnexus_check_analysis({"task_id": "${currentAnalysisTaskId}"})`);
      }
    },
  };
};

export { DEFAULT_MCP_COMMAND, GITNEXUS_PROTOCOL, gitNexusPlugin as server };
export default gitNexusPlugin;
