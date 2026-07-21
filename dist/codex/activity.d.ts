import type { PathmarkToolActivity } from "../types.js";
export interface ToolActivityInput {
    tool_name?: string;
    tool_input?: unknown;
    tool_response?: unknown;
    tool_output?: unknown;
    tool_result?: unknown;
    tool_use_id?: string;
    call_id?: string;
    duration_ms?: number;
}
export interface CapturedToolActivity {
    summary: string;
    activity: PathmarkToolActivity;
    redacted: boolean;
}
export declare function captureToolActivity(input: ToolActivityInput, options?: {
    includeOutputPreview?: boolean;
}): CapturedToolActivity | undefined;
export declare function digest(text: string): string;
