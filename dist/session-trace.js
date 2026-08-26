import { redactSecrets } from "./redact.js";
export async function sessionTrace(store, sessionId, options = {}) {
    const selectedLimit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const records = await store.recordsWithTags([`session:${sessionId}`], { limit: Math.min(2_000, selectedLimit * 4 + 1) });
    const traceRecords = records.filter(isTraceRecord);
    const selected = traceRecords.slice(0, selectedLimit).sort(compareChronologically);
    return {
        mode: "session_trace",
        sessionId,
        entries: selected.map((record) => traceEntry(record, options.includeOutputs !== false)),
        truncated: traceRecords.length > selectedLimit,
    };
}
function traceEntry(record, includeOutputs) {
    const base = { recordId: record.id, at: record.createdAt };
    if (record.activity?.type === "recall") {
        return {
            ...base,
            type: "recall",
            memoryIds: record.activity.memoryIds,
            memoryCount: record.activity.memoryCount,
            queryHash: record.activity.queryHash,
        };
    }
    if (record.activity?.type === "recall_feedback") {
        return {
            ...base,
            type: "recall_feedback",
            recallId: record.activity.recallId,
            relevantIds: record.activity.relevantIds,
            irrelevantIds: record.activity.irrelevantIds,
        };
    }
    if (record.activity?.type === "tool") {
        return { ...base, type: "tool", summary: safeText(record.text, 500), ...publicToolActivity(record.activity, includeOutputs) };
    }
    if (record.tags.includes("role-user"))
        return { ...base, type: "user", text: safeText(record.text, 4_000) };
    if (record.tags.includes("role-assistant"))
        return { ...base, type: "assistant", text: safeText(record.text, 4_000) };
    return { ...base, type: "tool", summary: safeText(record.text, 500), legacy: true };
}
function publicToolActivity(activity, includeOutputs) {
    const { outputPreview, ...rest } = activity;
    return {
        ...rest,
        ...(includeOutputs && outputPreview ? { outputPreview } : {}),
    };
}
function isTraceRecord(record) {
    return Boolean(record.activity ||
        record.tags.includes("role-user") ||
        record.tags.includes("role-assistant") ||
        record.tags.includes("role-tool"));
}
function compareChronologically(a, b) {
    return a.createdAt.localeCompare(b.createdAt) || traceOrder(a) - traceOrder(b) || a.id.localeCompare(b.id);
}
function traceOrder(record) {
    if (record.tags.includes("role-user"))
        return 0;
    if (record.activity?.type === "recall")
        return 1;
    if (record.activity?.type === "recall_feedback")
        return 2;
    if (record.activity?.type === "tool" || record.tags.includes("role-tool"))
        return 3;
    if (record.tags.includes("role-assistant"))
        return 4;
    return 5;
}
function safeText(text, limit) {
    const safe = redactSecrets(text).text;
    if (safe.length <= limit)
        return safe;
    return `${safe.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}
//# sourceMappingURL=session-trace.js.map