import type { Plugin } from "@opencode-ai/plugin";
declare const DEFAULT_MCP_COMMAND: string[];
declare const GITNEXUS_PROTOCOL = "IMPORTANT \u2014 GitNexus Integration Protocol:\n1. GitNexus provides code intelligence tools (query, context, impact) for understanding repositories.\n2. The plugin auto-analyzes source code repos when opened. Check analysis status with gitnexus_check_analysis.\n3. Use background_output tool with the task_id to check status of ongoing analyses.\n4. Prefer GitNexus tools for understanding code structure, dependencies, and impact analysis.\n5. Before making significant code changes, check impact with GitNexus to understand what might break.\n\nHelpful usage:\n- gitnexus_query: Search codebase with natural language\n- gitnexus_context: Get context about specific code locations\n- gitnexus_impact: Analyze impact of proposed changes\n- gitnexus_check_analysis: Check status of auto-analysis tasks\n\nThis protocol keeps code work grounded in repository intelligence.";
declare const gitNexusPlugin: Plugin;
export { DEFAULT_MCP_COMMAND, GITNEXUS_PROTOCOL, gitNexusPlugin as server };
export default gitNexusPlugin;
