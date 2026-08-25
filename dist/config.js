import os from "node:os";
import path from "node:path";
function expandHome(input) {
    if (input === "~")
        return os.homedir();
    if (input.startsWith("~/"))
        return path.join(os.homedir(), input.slice(2));
    return input;
}
function envValue(name, fallback) {
    const value = process.env[name];
    return value && value.trim() ? value : fallback;
}
function envFlag(name, fallback) {
    const value = process.env[name]?.trim().toLowerCase();
    if (!value)
        return fallback;
    if (["0", "false", "off", "no"].includes(value))
        return false;
    if (["1", "true", "on", "yes"].includes(value))
        return true;
    return fallback;
}
function envNonNegativeInt(name, fallback) {
    const parsed = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
export function loadConfig() {
    const storeDir = path.resolve(expandHome(envValue("PATHMARK_STORE_DIR", "~/.pathmark/memory")));
    return {
        storeDir,
        memoryFile: path.join(storeDir, "memory.jsonl"),
        synthesisProvider: synthesisProvider(),
        chatCommand: process.env.PATHMARK_CHAT_COMMAND,
        codexCommand: process.env.PATHMARK_CODEX_COMMAND ?? "codex",
        codexModel: process.env.PATHMARK_CODEX_MODEL,
        openaiBaseUrl: process.env.PATHMARK_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        openaiApiKey: process.env.PATHMARK_OPENAI_API_KEY,
        openaiModel: process.env.PATHMARK_OPENAI_MODEL,
        chatTimeoutMs: Number.parseInt(process.env.PATHMARK_CHAT_TIMEOUT_MS ?? "120000", 10),
        maxSearchResults: Number.parseInt(process.env.PATHMARK_MAX_SEARCH_RESULTS ?? "12", 10),
        codexProactiveRecall: envFlag("PATHMARK_CODEX_PROACTIVE_RECALL", true),
        codexVisibleRecall: envFlag("PATHMARK_CODEX_VISIBLE_RECALL", true),
        codexCaptureToolOutputs: envFlag("PATHMARK_CODEX_CAPTURE_TOOL_OUTPUTS", false),
        codexMemorySnapshot: envFlag("PATHMARK_CODEX_MEMORY_SNAPSHOT", true),
        snapshotCharLimit: Math.max(500, Math.min(envNonNegativeInt("PATHMARK_SNAPSHOT_CHARS", 4_000), 12_000)),
        codexRawRecallDays: Math.min(envNonNegativeInt("PATHMARK_CODEX_RAW_RECALL_DAYS", 30), 3_650),
        codexRawRecallLimit: Math.min(envNonNegativeInt("PATHMARK_CODEX_RAW_RECALL_LIMIT", 2), 2),
        codexProactiveConsolidation: envFlag("PATHMARK_CODEX_PROACTIVE_CONSOLIDATION", true),
        consolidationMinEvidence: Math.max(2, Math.min(envNonNegativeInt("PATHMARK_CONSOLIDATION_MIN_EVIDENCE", 8), 100)),
        conclusionApprovalRequired: envFlag("PATHMARK_CONCLUSION_APPROVAL", true),
        defaultNamespace: process.env.PATHMARK_NAMESPACE?.trim() || undefined,
        redactMcpWrites: envFlag("PATHMARK_REDACT_MCP_WRITES", true),
        retentionDays: envNonNegativeInt("PATHMARK_RETENTION_DAYS", 0),
        activityRetentionDays: envNonNegativeInt("PATHMARK_ACTIVITY_RETENTION_DAYS", 30),
        activityMaxRecords: Math.min(envNonNegativeInt("PATHMARK_ACTIVITY_MAX_RECORDS", 5_000), 100_000),
        rerankCommand: process.env.PATHMARK_RERANK_COMMAND?.trim() || undefined,
        hybridCandidateLimit: Math.max(10, Math.min(envNonNegativeInt("PATHMARK_HYBRID_CANDIDATES", 500), 2_000)),
        retrievalTimeoutMs: envNonNegativeInt("PATHMARK_RETRIEVAL_TIMEOUT_MS", 30_000),
        exportEncryptionKey: process.env.PATHMARK_EXPORT_KEY,
    };
}
function synthesisProvider() {
    const value = process.env.PATHMARK_SYNTHESIS_PROVIDER;
    if (value === "command" || value === "codex" || value === "openai-compatible")
        return value;
    if (process.env.PATHMARK_OPENAI_API_KEY && process.env.PATHMARK_OPENAI_MODEL)
        return "openai-compatible";
    if (process.env.PATHMARK_CHAT_COMMAND)
        return "command";
    return "client";
}
//# sourceMappingURL=config.js.map