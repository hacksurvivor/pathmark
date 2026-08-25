const INVISIBLE_CONTROL_RE = /[\u200b-\u200d\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const MEMORY_BOUNDARY_RE = /<\/?pathmark-memory(?:\s|>)/i;
const INSTRUCTION_OVERRIDE_RE = /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|messages?|rules?)\b/i;
const RUSSIAN_INSTRUCTION_OVERRIDE_RE = /\b(?:игнорируй|игнорировать|забудь|переопредели)\s+(?:все\s+)?(?:предыдущие|системные|разработчика)\s+(?:инструкции|сообщения|правила)\b/i;
export const QUARANTINED_MEMORY_TAG = "memory-quarantined";
export function isUnsafeMemoryText(text) {
    return (INVISIBLE_CONTROL_RE.test(text) ||
        MEMORY_BOUNDARY_RE.test(text) ||
        INSTRUCTION_OVERRIDE_RE.test(text) ||
        RUSSIAN_INSTRUCTION_OVERRIDE_RE.test(text));
}
//# sourceMappingURL=memory-safety.js.map