export type PathmarkRecordKind = "memory" | "conclusion";
export interface PathmarkRecordVersion {
    text: string;
    tags: string[];
    source: string;
    updatedAt: string;
}
export type PathmarkActivity = PathmarkRecallActivity | PathmarkToolActivity;
export interface PathmarkRecallActivity {
    type: "recall";
    queryHash: string;
    memoryIds: string[];
    memoryCount: number;
}
export interface PathmarkToolActivity {
    type: "tool";
    toolName: string;
    callId?: string;
    status: "success" | "error" | "unknown";
    commandPreview?: string;
    commandHash?: string;
    inputPreview?: string;
    inputHash?: string;
    exitCode?: number;
    durationMs?: number;
    outputPreview?: string;
    outputHash?: string;
    filesChanged: boolean | "unknown";
    changedFiles?: string[];
}
export interface PathmarkRecord {
    id: string;
    kind: PathmarkRecordKind;
    text: string;
    tags: string[];
    source: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
    expiresAt?: string;
    supersedes?: string;
    supersededBy?: string;
    occurrences?: number;
    history?: PathmarkRecordVersion[];
    activity?: PathmarkActivity;
}
export interface PathmarkRecordDraft {
    id?: string;
    kind: PathmarkRecordKind;
    text: string;
    tags?: string[];
    source?: string;
    createdAt?: string;
    updatedAt?: string;
    expiresAt?: string;
    supersedes?: string;
    activity?: PathmarkActivity;
}
export interface PathmarkConfig {
    storeDir: string;
    memoryFile: string;
    synthesisProvider: "client" | "command" | "codex" | "openai-compatible";
    chatCommand?: string;
    codexCommand: string;
    codexModel?: string;
    openaiBaseUrl: string;
    openaiApiKey?: string;
    openaiModel?: string;
    chatTimeoutMs: number;
    maxSearchResults: number;
    codexProactiveRecall: boolean;
    codexVisibleRecall: boolean;
    codexCaptureToolOutputs: boolean;
    defaultNamespace?: string;
    redactMcpWrites: boolean;
    retentionDays: number;
    activityRetentionDays: number;
    activityMaxRecords: number;
    rerankCommand?: string;
    hybridCandidateLimit: number;
    retrievalTimeoutMs: number;
    exportEncryptionKey?: string;
}
export interface SearchResult {
    record: PathmarkRecord;
    score: number;
    matchedTerms: string[];
    retrieval?: "lexical" | "hybrid";
}
export interface StoreDiagnosis {
    totalRecords: number;
    activeRecords: number;
    deletedRecords: number;
    expiredRecords: number;
    exactDuplicateRecords: number;
    conclusions: number;
    invalidRecordCount: number;
    indexFile: string;
}
export interface StoreMaintenanceResult extends StoreDiagnosis {
    applied: boolean;
    removedRecords: number;
    backupFile?: string;
}
export interface ActivityRetentionResult {
    applied: boolean;
    removedRecords: number;
}
