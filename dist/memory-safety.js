const INVISIBLE_CONTROL_RE = /[\u200b-\u200d\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const MEMORY_BOUNDARY_RE = /<\/?pathmark-memory(?:\s|>)/i;
const INSTRUCTION_OVERRIDE_RE = /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|messages?|rules?)\b/i;
const RUSSIAN_INSTRUCTION_OVERRIDE_RE = /\b(?:игнорируй|игнорировать|забудь|переопредели)\s+(?:все\s+)?(?:предыдущие|системные|разработчика)\s+(?:инструкции|сообщения|правила)\b/i;
export const QUARANTINED_MEMORY_TAG = "memory-quarantined";
/** Tag for a captured "user" message the owner didn't type: tool and agent messages delivered through the user channel. */
export const RELAYED_TAG = "relayed";
// Messages that arrive as user turns but come from a tool, another agent or the harness (T3 Code relays,
// delegated-task results, task notifications, context handoffs). They are never the owner's own words.
const RELAYED_PREFIXES = [
    /^\[T3 Code:/i,
    /^Delegated task node:/i,
    /^<task-notification>/i,
    /^Context handoff \(/i,
    /^Provider context handoff\b/i,
    /^\[Historical (?:user|assistant);/i,
    /^\[SYSTEM NOTIFICATION\b/i,
    /^\[From grokhost:/i,
    // Known harness envelopes. Listed explicitly: a pasted block (<pasted_content>) is the owner's own submission.
    /^<(?:heartbeat|in-app-browser-context|task|send_user_message|codex_delegation|realtime_delegation|subagent_notification|environment_context|system-reminder|local-command-stdout|local-command-caveat)\b/i,
];
export function isRelayedMessage(text) {
    const normalized = text.trimStart();
    return RELAYED_PREFIXES.some((pattern) => pattern.test(normalized));
}
export function isInternalInstructionText(text) {
    const normalized = text.trimStart();
    return (/^#{1,3}\s*(?:memory writing agent|response annotations|files mentioned by the user|diff comments)\b/i.test(normalized) ||
        /^#\s*overview\s+generate\s+0\s+to\s+3\s+hyperpersonalized\s+suggestions\b/i.test(normalized) ||
        /^you are (?:an?|the)\s+(?:expert|assistant|agent|model)\b/i.test(normalized) ||
        /^<(?:recommended_plugins|subagent_notification|codex_internal_context|pathmark-memory|environment_context|skills_instructions|realtime_delegation|skill)\b/i.test(normalized));
}
export function isUnsafeMemoryText(text) {
    return (INVISIBLE_CONTROL_RE.test(text) ||
        MEMORY_BOUNDARY_RE.test(text) ||
        INSTRUCTION_OVERRIDE_RE.test(text) ||
        RUSSIAN_INSTRUCTION_OVERRIDE_RE.test(text));
}
//# sourceMappingURL=memory-safety.js.map