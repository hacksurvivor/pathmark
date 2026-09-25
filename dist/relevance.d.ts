import type { SearchResult } from "./types.js";
export declare function selectRelevantResults(results: SearchResult[], query: string, limit: number, options?: {
    maxRequiredMatches?: number;
}): SearchResult[];
export declare function filterLowSignalResults(results: SearchResult[]): SearchResult[];
export declare function informativeSearchTerms(text: string): Set<string>;
