import os from "node:os";
import path from "node:path";
import type { PathmarkConfig } from "./types.js";

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function envValue(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["0", "false", "off", "no"].includes(value)) return false;
  if (["1", "true", "on", "yes"].includes(value)) return true;
  return fallback;
}

function envNonNegativeInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadConfig(): PathmarkConfig {
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
    defaultNamespace: process.env.PATHMARK_NAMESPACE?.trim() || undefined,
    redactMcpWrites: envFlag("PATHMARK_REDACT_MCP_WRITES", true),
    retentionDays: envNonNegativeInt("PATHMARK_RETENTION_DAYS", 0),
    rerankCommand: process.env.PATHMARK_RERANK_COMMAND?.trim() || undefined,
    hybridCandidateLimit: Math.max(10, Math.min(envNonNegativeInt("PATHMARK_HYBRID_CANDIDATES", 500), 2_000)),
    retrievalTimeoutMs: envNonNegativeInt("PATHMARK_RETRIEVAL_TIMEOUT_MS", 30_000),
    exportEncryptionKey: process.env.PATHMARK_EXPORT_KEY,
  };
}

function synthesisProvider(): PathmarkConfig["synthesisProvider"] {
  const value = process.env.PATHMARK_SYNTHESIS_PROVIDER;
  if (value === "command" || value === "codex" || value === "openai-compatible") return value;
  if (process.env.PATHMARK_OPENAI_API_KEY && process.env.PATHMARK_OPENAI_MODEL) return "openai-compatible";
  if (process.env.PATHMARK_CHAT_COMMAND) return "command";
  return "client";
}
