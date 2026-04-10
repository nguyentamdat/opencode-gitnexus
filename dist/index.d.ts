import type { Plugin, PluginInput } from "@opencode-ai/plugin";
interface AnalysisTask {
    taskId: string;
    dir: string;
    status: "running" | "completed" | "failed";
    startedAt: string;
    completedAt?: string;
    error?: string;
}
declare function isSourceCodeRepo(dir: string): boolean;
declare function getDirSizeMB(dir: string, shell: PluginInput["$"]): Promise<number>;
declare function runAnalysisInBackground(task: AnalysisTask, shell: PluginInput["$"]): Promise<void>;
declare function autoAnalyzeRepo(dir: string, maxSizeMB: number, shell: PluginInput["$"]): Promise<string | null>;
declare const gitNexusPlugin: Plugin;
export { gitNexusPlugin as server };
export default gitNexusPlugin;
export declare const _testing: {
    isSourceCodeRepo: typeof isSourceCodeRepo;
    getDirSizeMB: typeof getDirSizeMB;
    autoAnalyzeRepo: typeof autoAnalyzeRepo;
    runAnalysisInBackground: typeof runAnalysisInBackground;
    analysisTasks: Map<string, AnalysisTask>;
    GITNEXUS_PROTOCOL: string;
    SESSION_START_INSTRUCTION: string;
    DEFAULT_MCP_COMMAND: string[];
    DEFAULT_MAX_SIZE_MB: number;
    PLUGIN_VERSION: string;
};
