import type { PathmarkStore } from "./store.js";
import type { PathmarkConfig } from "./types.js";
export interface DreamOptions {
    /** Project names or `project:` tags. Default: every project with new evidence. */
    projects?: string[];
    /** Write conclusions, state and the digest. Without it the run is a preview. */
    apply?: boolean;
    /** Approve conclusions grounded in the owner's own words. Default: PATHMARK_DREAM_AUTO_APPROVE. */
    autoApprove?: boolean;
    maxProjects?: number;
    batchSize?: number;
    maxBatchesPerProject?: number;
    maxProposalsPerBatch?: number;
    /** Projects with fewer unreviewed evidence records are left for a later run. */
    minEvidence?: number;
    /** Only evidence from the last N days is considered. */
    days?: number;
    /** After consolidating, compact the store with this retention for raw capture (0 = keep). */
    retentionDays?: number;
    /** Keep tombstones this many days during compaction so merges carry deletes. */
    tombstoneDays?: number;
    compact?: boolean;
    digestFile?: string;
    now?: Date;
}
export declare function dreamMemory(store: PathmarkStore, config: PathmarkConfig, options?: DreamOptions): Promise<Record<string, unknown>>;
