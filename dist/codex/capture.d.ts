export interface CodexHookInput {
    cwd?: string;
    session_id?: string;
    prompt?: string;
    transcript_path?: string;
    tool_name?: string;
    tool_input?: unknown;
    tool_response?: unknown;
    tool_output?: unknown;
    tool_result?: unknown;
    tool_use_id?: string;
    call_id?: string;
    duration_ms?: number;
    timestamp?: string;
}
export declare function recall(input: CodexHookInput): Promise<string>;
export declare function prompt(input: CodexHookInput): Promise<string>;
export declare function observe(input: CodexHookInput): Promise<string>;
export declare function captureExternalTurn(input: {
    sessionId: string;
    cwd?: string;
    role: "user" | "assistant" | "tool";
    text: string;
    at?: string;
}): Promise<void>;
export declare function writeback(input: CodexHookInput): Promise<string>;
