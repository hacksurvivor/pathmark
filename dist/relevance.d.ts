import type { SearchResult } from "./types.js";
export declare function selectRelevantResults(results: SearchResult[], query: string, limit: number, options?: {
    maxRequiredMatches?: number;
    minRequiredMatches?: number;
    minCoverage?: number;
}): SearchResult[];
export declare function selectRelevantResultsByIntent(results: SearchResult[], query: string, limit: number, options?: {
    maxRequiredMatches?: number;
    minRequiredMatches?: number;
    minCoverage?: number;
}): SearchResult[];
export declare function splitQueryIntents(query: string): string[];
export declare function filterLowSignalResults(results: SearchResult[]): SearchResult[];
export declare function informativeSearchTerms(text: string): Set<string>;
