import type { PathmarkConfig, PathmarkRecord, SearchResult } from "./types.js";
export declare function jsonText(value: unknown): {
    content: Array<{
        type: "text";
        text: string;
    }>;
};
export declare function publicConfig(config: PathmarkConfig): Record<string, unknown>;
export declare function summarizeRecords(records: PathmarkRecord[], textLimit?: number): string;
export declare function summarizeSearch(results: SearchResult[], textLimit?: number): string;
export declare function usedMemories(results: SearchResult[], textLimit?: number): Array<Record<string, unknown>>;
