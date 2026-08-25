import type { PathmarkStore } from "./store.js";
import type { PathmarkConfig, PathmarkRecordKind, SearchResult } from "./types.js";
export interface MemoryQueryOptions {
    limit?: number;
    tags?: string[];
    kind?: PathmarkRecordKind;
}
export declare function relevantMemorySearch(store: PathmarkStore, config: PathmarkConfig, query: string, options?: MemoryQueryOptions): Promise<SearchResult[]>;
export declare function answerMemory(store: PathmarkStore, config: PathmarkConfig, question: string, options?: MemoryQueryOptions): Promise<Record<string, unknown>>;
