import type { PathmarkStore } from "./store.js";
import type { PathmarkRecord } from "./types.js";
export interface MemorySnapshot {
    mode: "approved_memory_snapshot";
    context: string;
    records: Array<Pick<PathmarkRecord, "id" | "text" | "tags" | "source" | "updatedAt">>;
    truncated: boolean;
    charLimit: number;
}
export declare function buildMemorySnapshot(store: PathmarkStore, input?: {
    scopeTags?: string[];
    charLimit?: number;
}): Promise<MemorySnapshot>;
