// Tools that only read the local store: no writes, no recall log, no network. Hosts may run these
// without a permission prompt. scripts/test-model-era.mjs asserts this list matches the tools
// annotated readOnlyHint && !openWorldHint, so a new or re-annotated tool cannot silently drift.
export const LOCAL_READ_ONLY_TOOLS = [
  "get_config",
  "search_memory",
  "get_context",
  "recall_memory",
  "session_trace",
  "list_conclusions",
  "list_pending_conclusions",
  "get_memory_snapshot",
  "audit_memory",
  "doctor_memory",
] as const;

// Claude Code permission rules use mcp__<server>__<tool>; `pathmark setup` registers the server as "pathmark".
export function claudeCodeAllowRules(serverName = "pathmark"): string[] {
  return LOCAL_READ_ONLY_TOOLS.map((tool) => `mcp__${serverName}__${tool}`);
}
