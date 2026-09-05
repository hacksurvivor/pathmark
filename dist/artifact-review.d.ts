import { z } from "zod";
import type { PathmarkStore } from "./store.js";
import type { PathmarkConfig, PathmarkRecord } from "./types.js";
export declare const scratchpadReviewSchema: z.ZodObject<{
    artifact: z.ZodObject<{
        title: z.ZodString;
        revision: z.ZodString;
        subpath: z.ZodEffects<z.ZodString, string, string>;
        sha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        revision: string;
        sha256: string;
        title: string;
        subpath: string;
    }, {
        revision: string;
        sha256: string;
        title: string;
        subpath: string;
    }>;
    decision: z.ZodEnum<["feedback", "changes", "approve"]>;
    notes: z.ZodString;
    selection: z.ZodOptional<z.ZodUnknown>;
}, "strict", z.ZodTypeAny, {
    decision: "feedback" | "changes" | "approve";
    artifact: {
        revision: string;
        sha256: string;
        title: string;
        subpath: string;
    };
    notes: string;
    selection?: unknown;
}, {
    decision: "feedback" | "changes" | "approve";
    artifact: {
        revision: string;
        sha256: string;
        title: string;
        subpath: string;
    };
    notes: string;
    selection?: unknown;
}>;
export interface ArtifactReviewCheck {
    evidenceId: string;
    status: "match" | "changed" | "unavailable";
    reason: string;
    checkedAt: string;
    artifact?: z.infer<typeof scratchpadReviewSchema>["artifact"];
    reportedDecision?: "feedback" | "changes" | "approve";
    actualSha256?: string;
    source?: string;
    authority: "reported-review-only";
}
export declare function importScratchpadReview(store: PathmarkStore, config: PathmarkConfig, input: {
    review: string;
    artifactRoot: string;
    source: string;
    tags: string[];
}): Promise<{
    evidence: PathmarkRecord;
    artifactCheck: ArtifactReviewCheck | undefined;
    instruction: string;
}>;
export declare function checkArtifactReview(record: PathmarkRecord, config: PathmarkConfig): Promise<ArtifactReviewCheck | undefined>;
