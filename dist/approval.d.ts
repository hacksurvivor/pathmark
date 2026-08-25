import type { PathmarkApprovalStatus, PathmarkRecord } from "./types.js";
export declare const APPROVAL_PENDING_TAG = "approval-pending";
export declare const APPROVAL_APPROVED_TAG = "approval-approved";
export declare const APPROVAL_REJECTED_TAG = "approval-rejected";
export declare const APPROVAL_STATE_TAGS: Set<string>;
export declare function conclusionApprovalStatus(record: Pick<PathmarkRecord, "kind" | "tags" | "approval">): PathmarkApprovalStatus | undefined;
export declare function isApprovedConclusion(record: Pick<PathmarkRecord, "kind" | "tags" | "approval">): boolean;
export declare function isRecallableRecord(record: Pick<PathmarkRecord, "kind" | "tags" | "approval">): boolean;
export declare function withApprovalTag(tags: string[], status: PathmarkApprovalStatus): string[];
