import type { SearchResult } from "./types.js";
export declare function selectRelevantResults(results: SearchResult[], query: string, limit: number): SearchResult[];
export declare function filterLowSignalResults(results: SearchResult[]): SearchResult[];
