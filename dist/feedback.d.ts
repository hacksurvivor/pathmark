import type { PathmarkStore } from "./store.js";
import type { PathmarkConfig, SearchResult } from "./types.js";
export declare function recordMemoryQueryRecall(store: PathmarkStore, config: PathmarkConfig, query: string, results: SearchResult[], tags?: string[]): Promise<string | undefined>;
export declare function recordRecallFeedback(store: PathmarkStore, config: PathmarkConfig, input: {
    recallId: string;
    relevantIds?: string[];
    irrelevantIds?: string[];
    note?: string;
}): Promise<Record<string, unknown>>;
