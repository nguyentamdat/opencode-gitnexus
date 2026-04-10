import type { Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { checkAndUpdate, type UpdateResult } from "./auto-update.js";
import { appendFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runCommand } from "./spawn.js";
import {
  DEFAULT_MCP_COMMAND,
  DEFAULT_MAX_SIZE_MB,
  GITNEXUS_PROTOCOL,
  SESSION_START_INSTRUCTION,
  analysisTasks,
  autoAnalyzeRepo,
} from "./core.js";

// Debug logger - write immediately to ensure file exists
const LOG_FILE = "/tmp/opencode-gitnexus.log";
try {
  writeFileSync(LOG_FILE, "", { flag: "a" }); // Ensure file exists
} catch {}

function log(level: string, message: string): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level}] ${message}\n`;
  try {
    appendFileSync(LOG_FILE, entry);
  } catch {}
}

// IMMEDIATE test log at module load
try {
  log("INFO", "!!! MODULE LOADED - TOP LEVEL !!!");
} catch (e) {
  // If this fails, we can't log anything
}

const require = createRequire(import.meta.url);
const PLUGIN_VERSION: string = require("../package.json").version;

// Module-level logging
log("INFO", "=== PLUGIN MODULE LOADED ===");
log("INFO", `Version: ${PLUGIN_VERSION}`);
log("INFO", `Module URL: ${import.meta.url}`);
log("INFO", "Exporting server and default...");

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
    log("INFO", "Plugin function invoked");
    const opts = (options ?? {}) as GitNexusPluginOptions;
    const mcpCommand = opts.mcpCommand ?? DEFAULT_MCP_COMMAND;
    const maxSizeMB = opts.autoAnalyzeMaxSizeMB ?? DEFAULT_MAX_SIZE_MB;
    log("INFO", `Plugin options: disableMcp=${opts.disableMcp}, disableProtocol=${opts.disableProtocol}, directory=${input.directory}`);

    const sessionsSeen = new Set<string>();
    let updateResult: UpdateResult | null = null;

    // Auto-update check
    if (!opts.disableAutoUpdate) {
      checkAndUpdate(async (cwd) => {
        return await runCommand("bun", ["install"], { cwd, timeout: 30000 });
      })
        .then((result) => {
          updateResult = result;
          if (result.updated) {
            log("INFO", `Auto-updated: ${result.currentVersion} → ${result.latestVersion}. Restart to apply.`);
          } else if (result.error) {
            log("INFO", `Update available: ${result.currentVersion} → ${result.latestVersion} (install failed: ${result.error})`);
          }
        })
        .catch(() => {});
    }

    // Auto-analyze current directory if enabled
    let currentAnalysisTaskId: string | null = null;
    if (!opts.disableAutoAnalyze && input.directory) {
      currentAnalysisTaskId = await autoAnalyzeRepo(input.directory, maxSizeMB, log);
      if (currentAnalysisTaskId) {
        log("INFO", `Analysis task: ${currentAnalysisTaskId}`);
      }
    }

    const result = {
      config: opts.disableMcp
        ? undefined
        : async (config: any) => {
            try {
              log("INFO", `Config hook called, disableMcp: ${opts.disableMcp}`);
              if (!config.mcp) config.mcp = {};
              if (!config.mcp.gitnexus) {
                config.mcp.gitnexus = {
                  type: "local" as const,
                  command: mcpCommand,
                };
                log("INFO", `GitNexus MCP registered: ${JSON.stringify(mcpCommand)}`);
              } else {
                log("INFO", "GitNexus MCP already exists");
              }
            } catch (err) {
              log("ERROR", `Failed to register MCP: ${err}`);
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

    log("INFO", `Plugin returning hooks: config=${typeof result.config}, system.transform=${typeof result["experimental.chat.system.transform"]}`);
    return result;
  } catch (err) {
    log("ERROR", `Plugin function threw error: ${err}`);
    throw err;
  }
};

export { gitNexusPlugin as server };
export default gitNexusPlugin;
