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
    supersede(id: string, input: PathmarkRecordDraft): Promise<PathmarkRecord | undefined>;
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
export declare function namespaceTag(namespace: string): string;
export {};
