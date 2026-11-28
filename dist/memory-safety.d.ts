export declare const QUARANTINED_MEMORY_TAG = "memory-quarantined";
/** Tag for a captured "user" message the owner didn't type: tool and agent messages delivered through the user channel. */
export declare const RELAYED_TAG = "relayed";
export declare function isRelayedMessage(text: string): boolean;
export declare function isInternalInstructionText(text: string): boolean;
export declare function isUnsafeMemoryText(text: string): boolean;
