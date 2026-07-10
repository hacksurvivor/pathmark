import type { PathmarkConfig, PathmarkRecord, PathmarkRecordDraft, PathmarkRecordKind, SearchResult } from "./types.js";
interface StoreHealth {
    indexFile: string;
    invalidRecordCount: number;
}
interface AddRecordsOptions {
    backupFile?: string;
}
export declare class PathmarkStore {
    private readonly config;
    private db?;
    private syncPromise?;
    constructor(config: PathmarkConfig);
    ensureReady(): Promise<void>;
    add(input: PathmarkRecordDraft): Promise<PathmarkRecord>;
    addRecord(input: PathmarkRecordDraft): Promise<{
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
    count(): Promise<number>;
    recordsWithTags(tags: string[], options?: {
        kind?: PathmarkRecordKind;
        limit?: number;
    }): Promise<PathmarkRecord[]>;
    health(): Promise<StoreHealth>;
    delete(id: string): Promise<PathmarkRecord | undefined>;
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
    private withWriteLock;
}
export {};
