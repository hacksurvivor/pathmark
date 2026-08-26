export type PathmarkRecordKind = "memory" | "conclusion";
export type PathmarkApprovalStatus = "pending" | "approved" | "rejected";
export interface PathmarkApproval {
    status: PathmarkApprovalStatus;
    proposedAt: string;
    decidedAt?: string;
    decidedBy?: string;
    note?: string;
}
export interface PathmarkRecordVersion {
    text: string;
    tags: string[];
    source: string;
    updatedAt: string;
}
export type PathmarkActivity = PathmarkRecallActivity | PathmarkRecallFeedbackActivity | PathmarkToolActivity;
export interface PathmarkRecallActivity {
    type: "recall";
    queryHash: string;
    memoryIds: string[];
    memoryCount: number;
}
export interface PathmarkRecallFeedbackActivity {
    type: "recall_feedback";
    recallId: string;
    relevantIds: string[];
    irrelevantIds: string[];
    note?: string;
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
    approval?: PathmarkApproval;
    evidenceIds?: string[];
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
    approval?: PathmarkApproval;
    evidenceIds?: string[];
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
    codexMemorySnapshot: boolean;
    snapshotCharLimit: number;
    codexRawRecallDays: number;
    codexRawRecallLimit: number;
    codexProactiveConsolidation: boolean;
    consolidationMinEvidence: number;
    conclusionApprovalRequired: boolean;
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
    pendingConclusions: number;
    approvedConclusions: number;
    rejectedConclusions: number;
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
