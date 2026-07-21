export interface CaptureCursor {
    count: number;
    updatedAt: string;
    transcriptFingerprint?: string;
    parserVersion?: number;
}
export declare function cursorPath(storeDir: string, sessionId: string): string;
export declare function readCursor(storeDir: string, sessionId: string): Promise<number>;
export declare function readCursorState(storeDir: string, sessionId: string): Promise<CaptureCursor>;
export declare function writeCursor(storeDir: string, sessionId: string, count: number, metadata?: {
    transcriptFingerprint?: string;
    parserVersion?: number;
}): Promise<void>;
