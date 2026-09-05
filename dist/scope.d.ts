import type { PathmarkRecord } from "./types.js";
import type { PathmarkStore } from "./store.js";
export declare const SCOPE_PREFIXES: string[];
export declare const isScopeTag: (tag: string) => boolean;
export type EvidenceMap = Map<string, PathmarkRecord | undefined>;
export declare function loadScopeEvidence(store: PathmarkStore, records: PathmarkRecord[]): Promise<EvidenceMap>;
export declare function effectiveTags(record: PathmarkRecord, evidence: EvidenceMap): string[];
export declare function matchesEffectiveTags(record: PathmarkRecord, required: string[], evidence: EvidenceMap): boolean;
export declare function appliesToScope(record: PathmarkRecord, requested: string[], evidence: EvidenceMap): boolean;
