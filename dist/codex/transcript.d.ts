export interface CodexTurn {
    role: "user" | "assistant";
    text: string;
    at?: string;
    index: number;
}
export interface CodexToolResult {
    callId: string;
    output: string;
    at?: string;
    status: "success" | "error" | "unknown";
    exitCode?: number;
    durationMs?: number;
}
export declare function readCodexTranscript(file: string): Promise<CodexTurn[]>;
export declare function readCodexTranscriptStrict(file: string): Promise<CodexTurn[]>;
export declare function readCodexToolResults(file: string): Promise<CodexToolResult[]>;
export declare function readCodexLegacyNoiseTurns(file: string): Promise<CodexTurn[]>;
export declare function parseTranscriptEvent(event: unknown, index: number): CodexTurn | undefined;
export declare function normalizeCodexUserMessage(text: string): string;
