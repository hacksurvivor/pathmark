import type { PathmarkConfig, PathmarkRecord, SearchResult } from "./types.js";
import { redactSecrets } from "./redact.js";

// Per-record text budget for summary blocks. `limit` bounds result COUNT, not
// size, so without this a few large records produce 100k+ character payloads
// that overflow harness tool-output caps. usedMemories() carries the shorter
// preview; callers needing full text fetch by id.
const SUMMARY_TEXT_LIMIT = 600;

export function jsonText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function publicConfig(config: PathmarkConfig): Record<string, unknown> {
  return {
    storeDir: config.storeDir,
    memoryFile: config.memoryFile,
    synthesisProvider: config.synthesisProvider,
    chatCommand: config.chatCommand ? "configured" : "not_configured",
    codexCommand: config.codexCommand,
    codexModel: config.codexModel ?? "default",
    openaiBaseUrl: config.openaiBaseUrl,
    openaiApiKey: config.openaiApiKey ? "set" : "missing",
    openaiModel: config.openaiModel ?? "unset",
    chatTimeoutMs: config.chatTimeoutMs,
    maxSearchResults: config.maxSearchResults,
    codexProactiveRecall: config.codexProactiveRecall,
    codexVisibleRecall: config.codexVisibleRecall,
    codexCaptureToolOutputs: config.codexCaptureToolOutputs,
    codexMemorySnapshot: config.codexMemorySnapshot,
    snapshotCharLimit: config.snapshotCharLimit,
    conclusionApprovalRequired: config.conclusionApprovalRequired,
    defaultNamespace: config.defaultNamespace ?? "unscoped",
    redactMcpWrites: config.redactMcpWrites,
    retentionDays: config.retentionDays,
    activityRetentionDays: config.activityRetentionDays,
    activityMaxRecords: config.activityMaxRecords,
    rerankCommand: config.rerankCommand ? "configured" : "not_configured",
    hybridCandidateLimit: config.hybridCandidateLimit,
    retrievalTimeoutMs: config.retrievalTimeoutMs,
    exportEncryptionKey: config.exportEncryptionKey ? "set" : "missing",
  };
}

export function summarizeRecords(records: PathmarkRecord[], textLimit = SUMMARY_TEXT_LIMIT): string {
  if (records.length === 0) return "No records found.";

  return records
    .map((record) => {
      const tagText = record.tags.length > 0 ? ` tags=${record.tags.join(",")}` : "";
      return `- ${record.kind} ${record.id} (${record.createdAt}${tagText})\n  ${truncate(record.text, textLimit)}`;
    })
    .join("\n");
}

export function summarizeSearch(results: SearchResult[], textLimit = SUMMARY_TEXT_LIMIT): string {
  if (results.length === 0) return "No matching memory found.";

  return results
    .map((result) => {
      const record = result.record;
      const matches = result.matchedTerms.length > 0 ? ` matches=${result.matchedTerms.join(",")}` : "";
      const tagText = record.tags.length > 0 ? ` tags=${record.tags.join(",")}` : "";
      return `- ${record.kind} ${record.id} score=${result.score}${matches} (${record.createdAt}${tagText})\n  ${truncate(record.text, textLimit)}`;
    })
    .join("\n");
}

export function usedMemories(results: SearchResult[], textLimit = 240): Array<Record<string, unknown>> {
  return results.map((result, index) => {
    const record = result.record;
    const redacted = redactSecrets(record.text);
    return {
      index: index + 1,
      id: record.id,
      kind: record.kind,
      createdAt: record.createdAt,
      source: record.source,
      score: result.score,
      matchedTerms: result.matchedTerms,
      tags: record.tags,
      preview: truncate(redacted.text, textLimit),
    };
  });
}

function truncate(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}
