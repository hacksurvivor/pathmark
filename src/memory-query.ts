import { synthesizeWithCommand } from "./chat.js";
import { summarizeSearch, usedMemories } from "./format.js";
import { isUnsafeMemoryText, QUARANTINED_MEMORY_TAG } from "./memory-safety.js";
import { selectRelevantResults } from "./relevance.js";
import type { PathmarkStore } from "./store.js";
import type { PathmarkConfig, PathmarkRecordKind, SearchResult } from "./types.js";

export interface MemoryQueryOptions {
  limit?: number;
  tags?: string[];
  kind?: PathmarkRecordKind;
}

export async function relevantMemorySearch(
  store: PathmarkStore,
  config: PathmarkConfig,
  query: string,
  options: MemoryQueryOptions = {},
): Promise<SearchResult[]> {
  const selectedLimit = options.limit ?? config.maxSearchResults;
  if (options.kind) return relevantKindSearch(store, query, selectedLimit, options.tags ?? [], options.kind);

  const conclusions = await relevantKindSearch(store, query, selectedLimit, options.tags ?? [], "conclusion");
  if (conclusions.length > 0) return conclusions;
  return relevantKindSearch(store, query, selectedLimit, options.tags ?? [], "memory");
}

export async function answerMemory(
  store: PathmarkStore,
  config: PathmarkConfig,
  question: string,
  options: MemoryQueryOptions = {},
): Promise<Record<string, unknown>> {
  const results = await relevantMemorySearch(store, config, question, options);
  const answer = await synthesizeWithCommand({ config, question, context: results });
  return {
    answer: answer ?? null,
    synthesis: answer ? config.synthesisProvider : "client_should_synthesize",
    retrievalMode:
      options.kind ?? (results[0]?.record.kind === "conclusion" ? "approved_conclusions" : "raw_evidence_fallback"),
    context: summarizeSearch(results),
    usedMemories: usedMemories(results),
    records: results.map((result) => result.record),
    ...(answer
      ? {}
      : {
          nextStep:
            "The MCP host should answer from context, or configure PATHMARK_SYNTHESIS_PROVIDER=codex|command|openai-compatible for server-side synthesis.",
        }),
  };
}

async function relevantKindSearch(
  store: PathmarkStore,
  query: string,
  limit: number,
  tags: string[],
  kind: PathmarkRecordKind,
): Promise<SearchResult[]> {
  const candidateLimit = query.trim() ? Math.min(100, Math.max(20, limit * 4)) : limit;
  const candidates = (await store.search({ query, limit: candidateLimit, tags, kind })).filter(
    (result) =>
      !result.record.tags.includes("pathmark-activity") &&
      !result.record.tags.includes(QUARANTINED_MEMORY_TAG) &&
      !isUnsafeMemoryText(result.record.text),
  );
  return query.trim() ? selectRelevantResults(candidates, query, limit) : candidates.slice(0, limit);
}
