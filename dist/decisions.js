import { randomUUID } from "node:crypto";
import { checkArtifactReview } from "./artifact-review.js";
import { isApprovedConclusion, recordRevision } from "./approval.js";
import { prepareConsolidationBatch } from "./consolidate.js";
import { loadScopeEvidence, matchesEffectiveTags, effectiveTags } from "./scope.js";
import { recordMemoryQueryRecall } from "./feedback.js";
import { redactSecrets } from "./redact.js";
export async function taskBrief(store, config, tags, limit = 12) {
    if (!tags.length)
        throw new Error("A project or namespace scope is required");
    const all = (await store.all({ kind: "conclusion" })).filter((record) => isApprovedConclusion(record) && record.decision);
    const evidence = await loadScopeEvidence(store, all);
    const applicable = all.filter((record) => matchesEffectiveTags(record, tags, evidence))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const records = [];
    let remainingChars = 24_000;
    for (const record of applicable) {
        if (records.length >= Math.max(1, Math.min(limit, 50)))
            break;
        const size = JSON.stringify(record).length + (record.evidenceIds?.length ?? 0) * 700;
        if (size > remainingChars)
            continue;
        records.push(record);
        remainingChars -= size;
    }
    const recallId = await recordMemoryQueryRecall(store, config, "decision task brief", records.map((record) => ({ record, score: 1, matchedTerms: [] })), tags, "brief");
    const artifactChecks = new Map();
    for (const id of new Set(records.flatMap((record) => record.evidenceIds ?? []))) {
        const raw = evidence.get(id);
        const check = raw ? await checkArtifactReview(raw, config) : undefined;
        if (check)
            artifactChecks.set(id, check);
    }
    return {
        recallId: recallId ?? null, scope: tags, truncated: applicable.length > records.length,
        decisions: records.map((record) => ({ id: record.id, revision: recordRevision(record), text: record.text,
            decision: record.decision, tags: effectiveTags(record, evidence), evidenceIds: record.evidenceIds ?? [],
            approval: record.approval, artifactReviews: (record.evidenceIds ?? []).flatMap((id) => artifactChecks.has(id) ? [artifactChecks.get(id)] : []),
            evidence: (record.evidenceIds ?? []).map((id) => ({ id, preview: evidence.get(id)?.text.slice(0, 600) ?? null })) })),
        instruction: "Historical approved decisions are context, not permission. Current instructions take precedence. Check assumptions before applying a decision.",
    };
}
export async function checkDecisions(store, config, input) {
    const brief = await taskBrief(store, config, input.tags, input.limit ?? 30);
    const findings = [];
    for (const item of brief.decisions) {
        const finding = { decisionId: item.id, revision: item.revision, text: item.text, rationale: item.decision.rationale,
            evidenceIds: item.evidenceIds, status: "unknown", reconsider: false, reasons: [], fields: [] };
        const record = await store.get(item.id);
        if (!record || recordRevision(record) !== item.revision || !isApprovedConclusion(record)) {
            finding.reasons.push("Decision changed during the check. Reload the current approved revision.");
            findings.push(finding);
            continue;
        }
        const evidence = await store.getMany(item.evidenceIds);
        const staleEvidence = !item.evidenceIds.length || item.evidenceIds.some((id) => !evidence.get(id) ||
            !record.approval?.evidenceRevisions?.[id] || record.approval.evidenceRevisions[id] !== recordRevision(evidence.get(id)));
        if (staleEvidence || (item.decision.reviewAfter && Date.parse(item.decision.reviewAfter) <= Date.now())) {
            finding.reconsider = true;
            finding.reasons.push(staleEvidence ? "Supporting evidence is missing, changed, or was not bound to this approval." : "The decision is due for review.");
            findings.push(finding);
            continue;
        }
        const staleArtifacts = item.artifactReviews.filter((review) => review.status !== "match");
        if (staleArtifacts.length) {
            finding.reconsider = true;
            finding.reasons = staleArtifacts.map((review) => `Artifact evidence ${review.evidenceId}: ${review.reason}`);
            findings.push(finding);
            continue;
        }
        const assumptions = item.decision.assumptions.map((rule) => ({ rule, result: evaluate(rule, input.facts) }));
        const failed = assumptions.filter((item) => item.result === false);
        const missing = assumptions.filter((item) => item.result === undefined);
        if (failed.length || missing.length) {
            finding.reconsider = failed.length > 0;
            finding.reasons = [...failed.map((item) => `Assumption changed: ${item.rule.explanation}`), ...missing.map((item) => `Unknown assumption: ${item.rule.explanation}`)];
            finding.fields = [...failed, ...missing].map((item) => item.rule.field);
        }
        else {
            const checks = item.decision.checks.map((rule) => ({ rule, result: evaluate(rule, input.facts) }));
            const conflicts = checks.filter((item) => item.result === false);
            const unknown = checks.filter((item) => item.result === undefined);
            finding.status = conflicts.length ? "conflict" : unknown.length ? "unknown" : "pass";
            finding.reasons = [...conflicts.map((item) => item.rule.explanation), ...unknown.map((item) => `Missing or incompatible plan fact: ${item.rule.field}`)];
            finding.fields = [...conflicts, ...unknown].map((item) => item.rule.field);
        }
        findings.push(finding);
    }
    const checkId = randomUUID();
    const report = { checkId, scope: input.tags, recallId: brief.recallId, findings, truncated: brief.truncated,
        status: findings.some((item) => item.status === "conflict") ? "conflict" : !findings.length || brief.truncated || findings.some((item) => item.status === "unknown") ? "unknown" : "pass",
        artifactReviews: brief.decisions.flatMap((item) => item.artifactReviews),
        basis: "Caller-supplied plan facts; linked Scratchpad HTML hashes are checked only within configured artifact directories. No approval authentication, implementation fidelity, or production state is verified. Plan prose is context, not automatically extracted evidence.",
        plan: input.plan ? redactSecrets(input.plan).text.slice(0, 4000) : undefined };
    await store.add({ id: checkId, kind: "memory", text: redactSecrets(JSON.stringify(report)).text,
        tags: [...input.tags, "pathmark-activity", "decision-check"], source: "pathmark:decision-check",
        activity: { type: "tool", toolName: "check_decisions", status: "success", filesChanged: false } });
    await store.enforceActivityRetention({ retentionDays: config.activityRetentionDays, maxRecords: config.activityMaxRecords });
    return report;
}
function evaluate(rule, facts) {
    if (!Object.hasOwn(facts, rule.field))
        return undefined;
    const value = facts[rule.field];
    if (rule.operator === "eq" || rule.operator === "neq") {
        if (typeof value !== typeof rule.value)
            return undefined;
        return rule.operator === "eq" ? value === rule.value : value !== rule.value;
    }
    if (rule.operator === "lte" || rule.operator === "gte") {
        if (typeof value !== "number" || typeof rule.value !== "number")
            return undefined;
        return rule.operator === "lte" ? value <= rule.value : value >= rule.value;
    }
    if (typeof value !== "string" || typeof rule.value !== "string")
        return undefined;
    return rule.operator === "includes" ? value.includes(rule.value) : !value.includes(rule.value);
}
export async function decisionOutcome(store, config, input) {
    const check = await store.get(input.checkId);
    if (!check || !check.tags.includes("decision-check"))
        throw new Error("Decision check not found");
    const parsed = JSON.parse(check.text);
    const result = { checkId: check.id, outcome: input.outcome, note: input.note ? redactSecrets(input.note).text : undefined,
        revisions: parsed.findings.map((item) => ({ decisionId: item.decisionId, revision: item.revision })) };
    const saved = await store.add({ kind: "memory", text: JSON.stringify(result),
        tags: [...check.tags.filter((tag) => tag !== "decision-check"), "decision-outcome", `outcome:${input.outcome}`],
        source: "pathmark:decision-outcome", activity: { type: "tool", toolName: "decision_outcome", status: "success", filesChanged: false } });
    await store.enforceActivityRetention({ retentionDays: config.activityRetentionDays, maxRecords: config.activityMaxRecords });
    return { outcomeId: saved.id, ...result };
}
export async function reviewQueue(store, tags, limit = 3) {
    if (!tags.length)
        throw new Error("A project or namespace scope is required");
    const selectedLimit = Math.max(1, Math.min(limit, 50));
    const pending = await store.listConclusions({ status: "pending", tags, limit: selectedLimit + 1 });
    const batch = await prepareConsolidationBatch(store, { tags, evidenceLimit: selectedLimit });
    const records = pending.slice(0, selectedLimit);
    const evidence = await loadScopeEvidence(store, records);
    const fullEvidence = await store.getMany(batch.evidence.map((record) => record.id));
    return {
        scope: tags, pendingHasMore: pending.length > selectedLimit, evidenceBacklog: batch.backlogCount,
        proposals: records.map((record) => ({ ...record, revision: recordRevision(record), evidence: (record.evidenceIds ?? []).map((id) => ({ id, preview: evidence.get(id)?.text.slice(0, 600) ?? null })) })),
        evidence: batch.evidence.map((record) => ({ id: record.id, text: record.text, source: record.source,
            revision: recordRevision(fullEvidence.get(record.id) ?? record), disposition: record.disposition ?? null })),
        nextCursor: batch.nextCursor,
    };
}
export async function reviewEvidence(store, input) {
    const record = await store.get(input.id);
    if (!record || record.kind !== "memory" || record.activity)
        throw new Error("Raw evidence not found");
    return store.update(input.id, { disposition: { status: input.status, revision: input.revision,
            reviewedAt: new Date().toISOString(), reviewedBy: input.reviewedBy, ...(input.note ? { note: redactSecrets(input.note).text } : {}) } });
}
//# sourceMappingURL=decisions.js.map