import { synthesizeWithCommand } from "./chat.js";
import { recordMemoryQueryRecall } from "./feedback.js";
import { summarizeSearch, usedMemories } from "./format.js";
import { isInternalInstructionText, isUnsafeMemoryText, QUARANTINED_MEMORY_TAG } from "./memory-safety.js";
import { selectRelevantResultsByIntent } from "./relevance.js";
export async function relevantMemorySearch(store, config, query, options = {}) {
    const selectedLimit = options.limit ?? config.maxSearchResults;
    if (options.kind)
        return relevantKindSearch(store, query, selectedLimit, options.tags ?? [], options.kind);
    const conclusions = await relevantKindSearch(store, query, selectedLimit, options.tags ?? [], "conclusion");
    if (conclusions.length > 0)
        return conclusions;
    if ((options.tags ?? []).length === 0)
        return [];
    return relevantKindSearch(store, query, selectedLimit, options.tags ?? [], "memory");
}
export async function answerMemory(store, config, question, options = {}) {
    const results = await relevantMemorySearch(store, config, question, options);
    const recallId = await recordMemoryQueryRecall(store, config, question, results, options.tags).catch(() => undefined);
    const synthesized = await synthesizeWithCommand({ config, question, context: results });
    const extractive = synthesized ? undefined : approvedConclusionAnswer(results);
    const answer = synthesized ?? extractive ?? (results.length === 0 ? "No approved conclusion or scoped raw evidence matched this question." : undefined);
    return {
        answer: answer ?? null,
        synthesis: synthesized
            ? config.synthesisProvider
            : extractive
                ? "approved_conclusion_extract"
                : results.length === 0
                    ? "pathmark_abstention"
                    : "client_should_synthesize",
        retrievalMode: results.length === 0
            ? "no_match"
            : options.kind ?? (results[0]?.record.kind === "conclusion" ? "approved_conclusions" : "raw_evidence_fallback"),
        context: summarizeSearch(results),
        usedMemories: usedMemories(results),
        records: results.map((result) => result.record),
        recallId: recallId ?? null,
        ...(answer
            ? {}
            : {
                nextStep: "The MCP host should answer from context, or configure PATHMARK_SYNTHESIS_PROVIDER=codex|command|openai-compatible for server-side synthesis.",
            }),
    };
}
async function relevantKindSearch(store, query, limit, tags, kind) {
    const candidateLimit = query.trim() ? Math.min(100, Math.max(20, limit * 4)) : limit;
    const candidates = (await store.search({ query, limit: candidateLimit, tags, kind })).filter((result) => !result.record.tags.includes("pathmark-activity") &&
        !result.record.tags.includes(QUARANTINED_MEMORY_TAG) &&
        !isUnsafeMemoryText(result.record.text) &&
        (kind !== "memory" || !isInternalInstructionText(result.record.text)));
    return query.trim() ? selectRelevantResultsByIntent(candidates, query, limit) : candidates.slice(0, limit);
}
function approvedConclusionAnswer(results) {
    if (results.length === 0 || results.some((result) => result.record.kind !== "conclusion"))
        return undefined;
    if (results.length === 1)
        return results[0].record.text;
    return ["Approved conclusions:", ...results.map((result) => `- ${result.record.text}`)].join("\n");
}
//# sourceMappingURL=memory-query.js.map