export interface ToolHookInput {
    tool_name?: string;
    tool_input?: unknown;
}
export declare function summarizeToolUse(input: ToolHookInput): string;
export declare function toolShellCommand(input: unknown): string;
export declare function toolChangedFiles(toolName: string, input: unknown): string[];
