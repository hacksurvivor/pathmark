import { PathmarkStore } from "./store.js";
export interface SessionTraceOptions {
    limit?: number;
    includeOutputs?: boolean;
}
export declare function sessionTrace(store: PathmarkStore, sessionId: string, options?: SessionTraceOptions): Promise<{
    mode: string;
    sessionId: string;
    entries: Record<string, unknown>[];
    truncated: boolean;
}>;
