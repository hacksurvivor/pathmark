import { type PathmarkStore } from "./store.js";
import type { PathmarkRecordDraft } from "./types.js";
export declare const CLAUDE_CODE_MEMORY_TAG = "claude-code-memory";
export interface NativeMemoryFile {
    id: string;
    file: string;
    projectSlug: string;
    cwd?: string;
    name: string;
    type?: string;
    text: string;
    modifiedAt: string;
}
export interface NativeImportResult {
    applied: boolean;
    scanned: number;
    created: number;
    updated: number;
    unchanged: number;
    deletedInPathmark: number;
    projects: number;
}
export declare function defaultClaudeProjectsDir(): string;
export declare function readClaudeCodeMemories(root: string, projectFilter?: string): Promise<NativeMemoryFile[]>;
export declare function parseMemoryMarkdown(raw: string, fallbackName: string): {
    name: string;
    type?: string;
    text: string;
};
export declare function resolveSlugPath(slug: string, base?: string): Promise<string | undefined>;
export declare function nativeMemoryDraft(memory: NativeMemoryFile, options: {
    namespace?: string;
    redact: boolean;
}): PathmarkRecordDraft;
export declare function importClaudeCodeMemories(store: PathmarkStore, memories: NativeMemoryFile[], options: {
    namespace?: string;
    redact: boolean;
    dryRun: boolean;
}): Promise<NativeImportResult>;
