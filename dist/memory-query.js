import { synthesizeWithCommand } from "./chat.js";
import { isApprovedConclusion } from "./approval.js";
import { recordMemoryQueryRecall } from "./feedback.js";
import { summarizeSearch, usedMemories } from "./format.js";
import { isInternalInstructionText, isUnsafeMemoryText, QUARANTINED_MEMORY_TAG } from "./memory-safety.js";
import { selectRelevantResultsByIntent, splitQueryIntents } from "./relevance.js";
import { appliesToScope, loadScopeEvidence, matchesEffectiveTags } from "./scope.js";
export async function relevantMemorySearch(store, config, query, options = {}) {
    const limit = options.limit ?? config.maxSearchResults;
    const tags = options.tags ?? [];
    const conclusions = await candidates("conclusion");
    const raw = options.kind === "conclusion" || (!tags.length && options.kind !== "memory") ? [] : await candidates("memory");
    const selected = new Map();
    const intents = query.trim() ? splitQueryIntents(query) : [query];
    // Give every intent one slot before spending the remaining budget on additional matches.
    const groups = [];
    for (const intent of intents.slice(0, 12)) {
        const approved = options.kind === "memory" ? [] : select(await store.rankRecords(conclusions.map((item) => item.record), intent, 100), intent);
        groups.push(approved.length ? approved : select(await store.rankRecords(raw.map((item) => item.record), intent, 100), intent));
    }
    for (let rank = 0; rank < limit; rank++) {
        for (const group of groups) {
            const item = group[rank];
            if (item)
                selected.set(item.record.id, item);
            if (selected.size >= limit)
                return [...selected.values()];
        }
    }
    return [...selected.values()];
    function select(items, intent) {
        return intent.trim() ? selectRelevantResultsByIntent(items, intent, limit, intents.length > 1 ? { maxRequiredMatches: 1 } : {}) : items.slice(0, limit);
    }
    async function candidates(kind) {
        if (options.kind && options.kind !== kind)
            return [];
        const records = (await store.all({ kind })).filter((record) => !record.tags.includes("pathmark-activity") && !record.tags.includes(QUARANTINED_MEMORY_TAG) &&
            !isUnsafeMemoryText(record.text) &&
            (kind === "conclusion" ? isApprovedConclusion(record) : !isInternalInstructionText(record.text)) &&
            (kind !== "memory" || options.rawRecallDays === undefined || Date.parse(record.updatedAt) >= Date.now() - options.rawRecallDays * 86400000));
        const evidence = await loadScopeEvidence(store, records);
        const scoped = records.filter((record) => options.applicableScope
            ? appliesToScope(record, tags, evidence) && (kind !== "memory" || matchesEffectiveTags(record, tags.filter((tag) => tag.startsWith("workspace:")).slice(0, 1), evidence))
            : matchesEffectiveTags(record, tags, evidence));
        return store.rankRecords(scoped, query, Math.max(100, limit * 4));
    }
}
export async function answerMemory(store, config, question, options = {}) {
    const results = await relevantMemorySearch(store, config, question, options);
    const recallId = await recordMemoryQueryRecall(store, config, question, results, options.tags).catch(() => undefined);
    const coverage = splitQueryIntents(question).map((intent) => ({
        intent, memoryIds: selectRelevantResultsByIntent(results, intent, results.length).map((item) => item.record.id),
    }));
    const unknownIntents = coverage.filter((item) => !item.memoryIds.length).map((item) => item.intent);
    const synthesized = await synthesizeWithCommand({ config, question, context: results });
    const extractive = results.length && results.every((item) => item.record.kind === "conclusion")
        ? results.length === 1 ? results[0].record.text : ["Approved conclusions:", ...results.map((item) => `- ${item.record.text}`)].join("\n") : undefined;
    let answer = synthesized ?? extractive ?? (results.length === 0 ? "No approved conclusion or scoped raw evidence matched this question." : undefined);
    if (answer && results.length && unknownIntents.length)
        answer += `\nUnanswered: ${unknownIntents.join("; ")}`;
    const mixed = results.some((item) => item.record.kind === "memory") && results.some((item) => item.record.kind === "conclusion");
    return {
        answer: answer ?? null,
        synthesis: synthesized ? config.synthesisProvider : extractive ? "approved_conclusion_extract" : results.length ? "client_should_synthesize" : "pathmark_abstention",
        retrievalMode: !results.length ? "no_match" : mixed ? "mixed_evidence" : options.kind ?? (results[0].record.kind === "conclusion" ? "approved_conclusions" : "raw_evidence_fallback"),
        context: summarizeSearch(results), usedMemories: usedMemories(results), records: results.map((item) => item.record),
        recallId: recallId ?? null, coverage, complete: unknownIntents.length === 0,
        ...(answer ? {} : { nextStep: "The MCP host should answer covered intents from the labeled context and explicitly identify unknowns. Raw evidence is not approved intent." }),
    };
}
//# sourceMappingURL=memory-query.js.map