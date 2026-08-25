import type { PathmarkStore } from "./store.js";
export interface MemoryAuditOptions {
    days?: number;
    tags?: string[];
    rawRecallDays?: number;
    rawRecallLimit?: number;
    now?: Date;
}
export declare function auditMemory(store: PathmarkStore, options?: MemoryAuditOptions): Promise<Record<string, unknown>>;
