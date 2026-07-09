import type { PathmarkConfig, PathmarkRecord, SearchResult } from "./types.js";
import { redactSecrets } from "./redact.js";

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
  };
}

export function summarizeRecords(records: PathmarkRecord[]): string {
  if (records.length === 0) return "No records found.";

  return records
    .map((record) => {
      const tagText = record.tags.length > 0 ? ` tags=${record.tags.join(",")}` : "";
      return `- ${record.kind} ${record.id} (${record.createdAt}${tagText})\n  ${record.text}`;
    })
    .join("\n");
}

export function summarizeSearch(results: SearchResult[]): string {
  if (results.length === 0) return "No matching memory found.";

  return results
    .map((result) => {
      const record = result.record;
      const matches = result.matchedTerms.length > 0 ? ` matches=${result.matchedTerms.join(",")}` : "";
      const tagText = record.tags.length > 0 ? ` tags=${record.tags.join(",")}` : "";
      return `- ${record.kind} ${record.id} score=${result.score}${matches} (${record.createdAt}${tagText})\n  ${record.text}`;
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
