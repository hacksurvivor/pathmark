import type { PathmarkConfig, PathmarkApprovalStatus, ActivityRetentionResult, PathmarkActivity, PathmarkRecord, PathmarkRecordDraft, PathmarkRecordKind, SearchResult, StoreDiagnosis, StoreMaintenanceResult } from "./types.js";
interface StoreHealth {
    indexFile: string;
    invalidRecordCount: number;
}
interface AddRecordsOptions {
    backupFile?: string;
    dedupe?: boolean;
}
export interface PurgeOptions {
    id?: string;
    tags?: string[];
    namespace?: string;
    source?: string;
    before?: string;
    dryRun?: boolean;
}
export interface CompactOptions {
    dedupe?: boolean;
    dropDeleted?: boolean;
    retentionDays?: number;
    /** Keep tombstones (deleted or superseded records) this many days so a merge can carry the delete to other copies. 0 drops them all. */
    tombstoneDays?: number;
    dryRun?: boolean;
}
export declare function closeOpenStores(): Promise<void>;
export declare class PathmarkStore {
    private readonly config;
    private db?;
    private syncPromise?;
    constructor(config: PathmarkConfig);
    close(): Promise<void>;
    ensureReady(): Promise<void>;
    add(input: PathmarkRecordDraft, options?: AddRecordsOptions): Promise<PathmarkRecord>;
    addRecord(input: PathmarkRecordDraft, options?: AddRecordsOptions): Promise<{
        record: PathmarkRecord;
        created: boolean;
    }>;
    addRecords(inputs: PathmarkRecordDraft[], options?: AddRecordsOptions): Promise<{
        record: PathmarkRecord;
        created: boolean;
    }[]>;
    all(options?: {
        includeDeleted?: boolean;
        kind?: PathmarkRecordKind;
    }): Promise<PathmarkRecord[]>;
    listConclusions(input?: {
        status?: PathmarkApprovalStatus;
        tags?: string[];
        limit?: number;
        offset?: number;
    }): Promise<PathmarkRecord[]>;
    proposeConclusion(input: Omit<PathmarkRecordDraft, "kind" | "approval">, options?: AddRecordsOptions): Promise<{
        record: PathmarkRecord;
        created: boolean;
    }>;
    decideConclusion(id: string, status: "approved" | "rejected", patch?: {
        text?: string;
        tags?: string[];
        decidedBy?: string;
        note?: string;
    }): Promise<PathmarkRecord | undefined>;
    count(): Promise<number>;
    recordsWithTags(tags: string[], options?: {
        kind?: PathmarkRecordKind;
        limit?: number;
    }): Promise<PathmarkRecord[]>;
    enforceActivityRetention(options: {
        retentionDays: number;
        maxRecords: number;
    }): Promise<ActivityRetentionResult>;
    health(): Promise<StoreHealth>;
    delete(id: string): Promise<PathmarkRecord | undefined>;
    deleteMany(ids: string[]): Promise<number>;
    get(id: string, options?: {
        includeDeleted?: boolean;
    }): Promise<PathmarkRecord | undefined>;
    getMany(ids: string[], options?: {
        includeDeleted?: boolean;
    }): Promise<Map<string, PathmarkRecord>>;
    searchByIds(input: {
        ids: string[];
        query: string;
        tags?: string[];
        kind?: PathmarkRecordKind;
    }): Promise<SearchResult[]>;
    update(id: string, patch: {
        text?: string;
        tags?: string[];
        source?: string;
        expiresAt?: string | null;
    }): Promise<PathmarkRecord | undefined>;
    updateActivities(updates: Map<string, PathmarkActivity>): Promise<number>;
    /**
     * Merge full records from another copy of the store (an export made with --include-deleted).
     * New ids are added as they are, tombstones included, so a delete is never resurrected later.
     * For an id both copies hold, the version with the later updatedAt wins: approvals, edits,
     * supersessions and deletes made on one machine reach the other.
     */
    mergeRecords(rawIncoming: unknown[]): Promise<{
        added: number;
        updated: number;
        unchanged: number;
    }>;
    supersede(id: string, input: PathmarkRecordDraft, options?: {
        requireStatus?: "pending" | "approved";
        requireUpdatedAt?: string;
    }): Promise<PathmarkRecord | undefined>;
    diagnose(): Promise<StoreDiagnosis>;
    purge(options: PurgeOptions): Promise<StoreMaintenanceResult>;
    compact(options?: CompactOptions): Promise<StoreMaintenanceResult>;
    backup(destination?: string): Promise<string>;
    exportTo(destination: string, options?: {
        tags?: string[];
        namespace?: string;
        kind?: PathmarkRecordKind;
        includeDeleted?: boolean;
        encrypted?: boolean;
    }): Promise<{
        file: string;
        recordCount: number;
    }>;
    search(input: {
        query: string;
        limit?: number;
        tags?: string[];
        kind?: PathmarkRecordKind;
    }): Promise<SearchResult[]>;
    private get indexFile();
    private database;
    private appendMany;
    private rewriteRecord;
    private rewriteRecords;
    private replaceCanonical;
    private createBackup;
    private withWriteLock;
}
/** Tags only automatic capture sets; together with role-user they mark the user's verbatim words. */
export declare const CAPTURE_MARKER_TAGS: Set<string>;
export declare function parseMergeRecord(value: unknown): PathmarkRecord | undefined;
export declare function namespaceTag(namespace: string): string;
export {};
