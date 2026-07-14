import type { SearchResult } from "./types.js";
export declare function rerankWithCommand(input: {
    command: string;
    query: string;
    candidates: SearchResult[];
    timeoutMs: number;
}): Promise<SearchResult[]>;
