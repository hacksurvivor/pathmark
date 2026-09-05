import { createHash } from "node:crypto";
export const APPROVAL_PENDING_TAG = "approval-pending";
export const APPROVAL_APPROVED_TAG = "approval-approved";
export const APPROVAL_REJECTED_TAG = "approval-rejected";
export const APPROVAL_STATE_TAGS = new Set([
    APPROVAL_PENDING_TAG,
    APPROVAL_APPROVED_TAG,
    APPROVAL_REJECTED_TAG,
]);
export function conclusionApprovalStatus(record) {
    if (record.kind !== "conclusion")
        return undefined;
    if (record.approval?.status === "approved" && record.approval.revision && record.approval.revision !== recordRevision(record))
        return "pending";
    if (record.approval?.status)
        return record.approval.status;
    if (record.tags.includes(APPROVAL_PENDING_TAG))
        return "pending";
    if (record.tags.includes(APPROVAL_REJECTED_TAG))
        return "rejected";
    // Conclusions written before the approval workflow remain durable and
    // recallable. This keeps upgrades backward compatible without silently
    // demoting already-curated memory.
    return "approved";
}
export function isApprovedConclusion(record) {
    return record.kind === "conclusion" && conclusionApprovalStatus(record) === "approved";
}
export function isRecallableRecord(record) {
    return record.kind !== "conclusion" || conclusionApprovalStatus(record) === "approved";
}
export function withApprovalTag(tags, status) {
    return [
        ...tags.filter((tag) => !APPROVAL_STATE_TAGS.has(tag.trim().toLowerCase())),
        approvalTag(status),
    ];
}
function approvalTag(status) {
    if (status === "pending")
        return APPROVAL_PENDING_TAG;
    if (status === "rejected")
        return APPROVAL_REJECTED_TAG;
    return APPROVAL_APPROVED_TAG;
}
export function recordRevision(record) {
    return createHash("sha256").update(JSON.stringify({
        kind: record.kind, text: record.text.trim(),
        tags: [...new Set(record.tags.filter((tag) => !APPROVAL_STATE_TAGS.has(tag)).map((tag) => tag.toLowerCase()))].sort(),
        source: record.source, evidenceIds: [...(record.evidenceIds ?? [])].sort(),
        decision: record.decision ?? null, expiresAt: record.expiresAt ?? null,
    })).digest("hex");
}
//# sourceMappingURL=approval.js.map