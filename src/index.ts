import type { Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { checkAndUpdate, type UpdateResult } from "./auto-update.js";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./spawn.js";
import { Logger, createLogger } from "./logger.js";
import {
  DEFAULT_MCP_COMMAND,
  DEFAULT_MAX_SIZE_MB,
  GITNEXUS_PROTOCOL,
  SESSION_START_INSTRUCTION,
  analysisTasks,
  autoAnalyzeRepo,
} from "./core.js";

// Module version
const require = createRequire(import.meta.url);
const PLUGIN_VERSION: string = require("../package.json").version;

// Lazy logger initialization - created on first use, not at module load
let logger: Logger | null = null;
function getLogger(): Logger {
  if (!logger) {
    const logPath = join(tmpdir(), "opencode-gitnexus.log");
    logger = createLogger(logPath);
    logger.info("=== PLUGIN MODULE LOADED ===", {
      version: PLUGIN_VERSION,
      moduleUrl: import.meta.url,
    });
  }
  return logger;
}

interface GitNexusPluginOptions extends Record<string, unknown> {
  mcpCommand?: string[];
  disableMcp?: boolean;
  disableProtocol?: boolean;
  disableAutoUpdate?: boolean;
  disableAutoAnalyze?: boolean;
  autoAnalyzeMaxSizeMB?: number;
}

const gitNexusPlugin: Plugin = async (input: PluginInput, options?: PluginOptions) => {
  try {
    getLogger().info("Plugin function invoked");
    const opts = (options ?? {}) as GitNexusPluginOptions;
    const mcpCommand = opts.mcpCommand ?? DEFAULT_MCP_COMMAND;
    const maxSizeMB = opts.autoAnalyzeMaxSizeMB ?? DEFAULT_MAX_SIZE_MB;
    getLogger().info("Plugin options", {
      disableMcp: opts.disableMcp,
      disableProtocol: opts.disableProtocol,
      directory: input.directory,
    });

    const sessionsSeen = new Set<string>();
    let updateResult: UpdateResult | null = null;

    // Auto-update check
    if (!opts.disableAutoUpdate) {
      checkAndUpdate(
        async (cwd) => {
          return await runCommand("bun", ["install"], { cwd, timeout: 30000 });
        },
        (level, message, context) => getLogger()[level](message, context)
      )
        .then((result) => {
          updateResult = result;
          if (result.updated) {
            getLogger().info("Auto-updated", {
              from: result.currentVersion,
              to: result.latestVersion,
            });
          } else if (result.error) {
            getLogger().warn("Update available but install failed", {
              from: result.currentVersion,
              to: result.latestVersion,
              error: result.error,
            });
          }
        })
        .catch((err) => {
          getLogger().error("Auto-update check failed", undefined, err instanceof Error ? err : new Error(String(err)));
        });
    }

    // Auto-analyze current directory if enabled
    let currentAnalysisTaskId: string | null = null;
    if (!opts.disableAutoAnalyze && input.directory) {
      currentAnalysisTaskId = await autoAnalyzeRepo(input.directory, maxSizeMB, getLogger());
      if (currentAnalysisTaskId) {
        getLogger().info("Analysis task created", { taskId: currentAnalysisTaskId });
      }
    }

    const result = {
      config: opts.disableMcp
        ? undefined
        : async (config: any) => {
            try {
              getLogger().info("Config hook called", { disableMcp: opts.disableMcp });
              if (!config.mcp) config.mcp = {};
              if (!config.mcp.gitnexus) {
                config.mcp.gitnexus = {
                  type: "local" as const,
                  command: mcpCommand,
                };
                getLogger().info("GitNexus MCP registered", { command: mcpCommand });
              } else {
                getLogger().info("GitNexus MCP already exists");
              }
            } catch (err) {
              getLogger().error("Failed to register MCP", undefined, err instanceof Error ? err : new Error(String(err)));
            }
          },

      "experimental.chat.system.transform": async (
        _input: { sessionID?: string; model: unknown },
        output: { system: string[] },
      ) => {
        if (!opts.disableProtocol) {
          output.system.push(GITNEXUS_PROTOCOL);
          output.system.push(`[opencode-gitnexus] Plugin v${PLUGIN_VERSION} active.`);
          // Show toast notification at session start
          input.client?.tui?.showToast({
            body: {
              title: `GitNexus ${PLUGIN_VERSION}`,
              message: "Code intelligence tools ready",
              variant: "info" as const,
              duration: 5000,
            },
          }).catch(() => {});
        }
        if (updateResult?.updated) {
          output.system.push(`[opencode-gitnexus] Updated ${updateResult.currentVersion} → ${updateResult.latestVersion}. Restart OpenCode to apply.`);
        }

        if (currentAnalysisTaskId) {
          const analysisTask = analysisTasks.get(currentAnalysisTaskId);
          if (analysisTask) {
            if (analysisTask.status === "running") {
              output.system.push(`[opencode-gitnexus] Auto-analyzing current repo (in progress). GitNexus tools will be available once analysis completes.`);
            } else if (analysisTask.status === "completed") {
              output.system.push(`[opencode-gitnexus] Auto-analysis complete. GitNexus tools are ready.`);
            } else if (analysisTask.status === "failed") {
              output.system.push(`[opencode-gitnexus] Auto-analysis failed: ${analysisTask.error ?? "unknown error"}. Run \`npx -y gitnexus analyze\` manually.`);
            }
          }
        }
      }
    };

    getLogger().info("Plugin returning hooks", {
      config: typeof result.config,
      systemTransform: typeof result["experimental.chat.system.transform"],
    });
    return result;
  } catch (err) {
    getLogger().error("Plugin function threw error", undefined, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
};

export { gitNexusPlugin as server };
export default gitNexusPlugin;
