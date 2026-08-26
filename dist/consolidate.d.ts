import type { PathmarkStore } from "./store.js";
import type { PathmarkConfig, PathmarkRecord } from "./types.js";
export interface ConsolidationOptions {
    tags?: string[];
    days?: number;
    evidenceLimit?: number;
    maxProposals?: number;
    apply?: boolean;
    cursor?: string;
    now?: Date;
}
export interface ConsolidationBatch {
    batchId: string | null;
    scope: {
        tags: string[];
    };
    backlogCount: number;
    alreadyReferencedCount: number;
    cursor: string | null;
    nextCursor: string | null;
    remainingAfterBatch: number;
    evidence: PathmarkRecord[];
    sessionIds: string[];
}
export declare function prepareConsolidationBatch(store: PathmarkStore, options?: ConsolidationOptions): Promise<ConsolidationBatch>;
export declare function consolidateMemory(store: PathmarkStore, config: PathmarkConfig, options?: ConsolidationOptions): Promise<Record<string, unknown>>;
export declare function consolidationNudge(batch: ConsolidationBatch, minimumEvidence: number): string;
export declare function isConsolidationEvidence(record: PathmarkRecord): boolean;
