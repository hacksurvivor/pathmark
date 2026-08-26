import { synthesizeWithCommand } from "./chat.js";
import { isApprovedConclusion } from "./approval.js";
import { recordMemoryQueryRecall } from "./feedback.js";
import { summarizeSearch, usedMemories } from "./format.js";
import { isInternalInstructionText, isUnsafeMemoryText, QUARANTINED_MEMORY_TAG } from "./memory-safety.js";
import { selectRelevantResultsByIntent } from "./relevance.js";
const INHERITABLE_SCOPE_PREFIXES = ["workspace:", "project:", "namespace:"];
const CONCLUSION_RESCORE_BATCH_SIZE = 50;
export async function relevantMemorySearch(store, config, query, options = {}) {
    const selectedLimit = options.limit ?? config.maxSearchResults;
    if (options.kind === "conclusion") {
        return relevantConclusionSearch(store, query, selectedLimit, options.tags ?? []);
    }
    if (options.kind === "memory") {
        return relevantKindSearch(store, query, selectedLimit, options.tags ?? [], "memory");
    }
    const conclusions = await relevantConclusionSearch(store, query, selectedLimit, options.tags ?? []);
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
    const candidates = await relevantKindCandidates(store, query, limit, tags, kind);
    return query.trim() ? selectRelevantResultsByIntent(candidates, query, limit) : candidates.slice(0, limit);
}
async function relevantConclusionSearch(store, query, limit, tags) {
    const requestedInheritedScopes = tags.filter(isInheritableScopeTag);
    if (requestedInheritedScopes.length === 0) {
        return relevantKindSearch(store, query, limit, tags, "conclusion");
    }
    const direct = await relevantKindCandidates(store, query, limit, tags, "conclusion");
    const nonInheritedTags = tags.filter((tag) => !isInheritableScopeTag(tag));
    const broader = (await store.all({ kind: "conclusion" }))
        .filter((record) => isApprovedConclusion(record) &&
        nonInheritedTags.every((tag) => record.tags.includes(tag)) &&
        !record.tags.includes("pathmark-activity") &&
        !record.tags.includes(QUARANTINED_MEMORY_TAG) &&
        !isUnsafeMemoryText(record.text))
        .map((record) => ({ record, score: 0, matchedTerms: [], retrieval: "lexical" }));
    const merged = new Map();
    for (const result of [...direct, ...broader]) {
        const existing = merged.get(result.record.id);
        if (!existing || result.score > existing.score)
            merged.set(result.record.id, result);
    }
    const evidenceIds = [...merged.values()]
        .filter((result) => requestedInheritedScopes.some((tag) => !result.record.tags.includes(tag)))
        .flatMap((result) => result.record.evidenceIds ?? []);
    const loadedEvidence = await store.getMany(evidenceIds, { includeDeleted: true });
    const evidenceCache = new Map();
    for (const id of new Set(evidenceIds))
        evidenceCache.set(id, loadedEvidence.get(id));
    const scoped = [];
    for (const result of merged.values()) {
        if (conclusionMatchesEffectiveTags(result.record, tags, evidenceCache))
            scoped.push(result);
    }
    const scopedIds = scoped.map((result) => result.record.id);
    const rescored = [];
    for (let index = 0; index < scopedIds.length; index += CONCLUSION_RESCORE_BATCH_SIZE) {
        rescored.push(...(await store.searchByIds({
            ids: scopedIds.slice(index, index + CONCLUSION_RESCORE_BATCH_SIZE),
            query,
            kind: "conclusion",
        })));
    }
    const ranked = rescored.sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt));
    return query.trim() ? selectRelevantResultsByIntent(ranked, query, limit) : ranked.slice(0, limit);
}
async function relevantKindCandidates(store, query, limit, tags, kind) {
    const candidateLimit = query.trim() ? Math.min(100, Math.max(20, limit * 4)) : limit;
    return (await store.search({ query, limit: candidateLimit, tags, kind })).filter((result) => !result.record.tags.includes("pathmark-activity") &&
        !result.record.tags.includes(QUARANTINED_MEMORY_TAG) &&
        !isUnsafeMemoryText(result.record.text) &&
        (kind !== "memory" || !isInternalInstructionText(result.record.text)));
}
function conclusionMatchesEffectiveTags(conclusion, requiredTags, evidenceCache) {
    const missing = requiredTags.filter((tag) => !conclusion.tags.includes(tag));
    if (missing.length === 0)
        return true;
    if (missing.some((tag) => !isInheritableScopeTag(tag)))
        return false;
    return evidenceSupportsScopes(conclusion, missing, evidenceCache);
}
function evidenceSupportsScopes(conclusion, requiredScopes, evidenceCache) {
    if (!conclusion.evidenceIds?.length)
        return false;
    return conclusion.evidenceIds.every((id) => {
        const evidence = evidenceCache.get(id);
        return evidence?.kind === "memory" && requiredScopes.every((tag) => evidence.tags.includes(tag));
    });
}
function isInheritableScopeTag(tag) {
    return INHERITABLE_SCOPE_PREFIXES.some((prefix) => tag.startsWith(prefix));
}
function approvedConclusionAnswer(results) {
    if (results.length === 0 || results.some((result) => result.record.kind !== "conclusion"))
        return undefined;
    if (results.length === 1)
        return results[0].record.text;
    return ["Approved conclusions:", ...results.map((result) => `- ${result.record.text}`)].join("\n");
}
//# sourceMappingURL=memory-query.js.map