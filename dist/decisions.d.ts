import { type ArtifactReviewCheck } from "./artifact-review.js";
import type { PathmarkStore } from "./store.js";
import type { DecisionSpec, EvidenceDisposition, PathmarkConfig } from "./types.js";
export type PlanFacts = Record<string, string | number | boolean>;
export interface DecisionFinding {
    decisionId: string;
    revision: string;
    text: string;
    rationale: string;
    evidenceIds: string[];
    status: "pass" | "conflict" | "unknown";
    reconsider: boolean;
    reasons: string[];
    fields: string[];
}
export declare function taskBrief(store: PathmarkStore, config: PathmarkConfig, tags: string[], limit?: number): Promise<{
    recallId: string | null;
    scope: string[];
    truncated: boolean;
    decisions: {
        id: string;
        revision: string;
        text: string;
        decision: {
            rationale: string;
            alternatives: string[];
            assumptions: {
                field: string;
                operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
                value: string | number | boolean;
                explanation: string;
            }[];
            checks: {
                field: string;
                operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
                value: string | number | boolean;
                explanation: string;
            }[];
            owner: string;
            reviewAfter?: string | undefined;
        };
        tags: string[];
        evidenceIds: string[];
        approval: import("./types.js").PathmarkApproval | undefined;
        artifactReviews: ArtifactReviewCheck[];
        evidence: {
            id: string;
            preview: string | null;
        }[];
    }[];
    instruction: string;
}>;
export declare function checkDecisions(store: PathmarkStore, config: PathmarkConfig, input: {
    tags: string[];
    facts: PlanFacts;
    plan?: string;
    limit?: number;
}): Promise<{
    checkId: `${string}-${string}-${string}-${string}-${string}`;
    scope: string[];
    recallId: string | null;
    findings: DecisionFinding[];
    truncated: boolean;
    status: string;
    artifactReviews: ArtifactReviewCheck[];
    basis: string;
    plan: string | undefined;
}>;
export declare function decisionOutcome(store: PathmarkStore, config: PathmarkConfig, input: {
    checkId: string;
    outcome: "useful" | "false-alarm" | "missed-conflict" | "decision-changed" | "no-effect";
    note?: string;
}): Promise<{
    checkId: string;
    outcome: "useful" | "false-alarm" | "missed-conflict" | "decision-changed" | "no-effect";
    note: string | undefined;
    revisions: {
        decisionId: string;
        revision: string;
    }[];
    outcomeId: string;
}>;
export declare function reviewQueue(store: PathmarkStore, tags: string[], limit?: number): Promise<{
    scope: string[];
    pendingHasMore: boolean;
    evidenceBacklog: number;
    proposals: {
        revision: string;
        evidence: {
            id: string;
            preview: string | null;
        }[];
        id: string;
        kind: import("./types.js").PathmarkRecordKind;
        text: string;
        tags: string[];
        source: string;
        createdAt: string;
        updatedAt: string;
        deletedAt?: string;
        expiresAt?: string;
        supersedes?: string;
        supersededBy?: string;
        occurrences?: number;
        history?: import("./types.js").PathmarkRecordVersion[];
        activity?: import("./types.js").PathmarkActivity;
        approval?: import("./types.js").PathmarkApproval;
        evidenceIds?: string[];
        decision?: DecisionSpec;
        disposition?: EvidenceDisposition;
    }[];
    evidence: {
        id: string;
        text: string;
        source: string;
        revision: string;
        disposition: {
            status: "incorporated" | "duplicate" | "temporary" | "rejected" | "needs-review";
            revision: string;
            reviewedAt: string;
            reviewedBy: string;
            note?: string | undefined;
        } | null;
    }[];
    nextCursor: string | null;
}>;
export declare function reviewEvidence(store: PathmarkStore, input: {
    id: string;
    revision: string;
    status: EvidenceDisposition["status"];
    reviewedBy: string;
    note?: string;
}): Promise<import("./types.js").PathmarkRecord | undefined>;
