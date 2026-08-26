const INVISIBLE_CONTROL_RE = /[\u200b-\u200d\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const MEMORY_BOUNDARY_RE = /<\/?pathmark-memory(?:\s|>)/i;
const INSTRUCTION_OVERRIDE_RE =
  /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|messages?|rules?)\b/i;
const RUSSIAN_INSTRUCTION_OVERRIDE_RE =
  /\b(?:игнорируй|игнорировать|забудь|переопредели)\s+(?:все\s+)?(?:предыдущие|системные|разработчика)\s+(?:инструкции|сообщения|правила)\b/i;

export const QUARANTINED_MEMORY_TAG = "memory-quarantined";

export function isInternalInstructionText(text: string): boolean {
  const normalized = text.trimStart();
  return (
    /^#{1,3}\s*(?:memory writing agent|response annotations|files mentioned by the user|diff comments)\b/i.test(normalized) ||
    /^#\s*overview\s+generate\s+0\s+to\s+3\s+hyperpersonalized\s+suggestions\b/i.test(normalized) ||
    /^you are (?:an?|the)\s+(?:expert|assistant|agent|model)\b/i.test(normalized) ||
    /^<(?:recommended_plugins|subagent_notification|codex_internal_context|pathmark-memory|environment_context|skills_instructions|realtime_delegation|skill)\b/i.test(
      normalized,
    )
  );
}

export function isUnsafeMemoryText(text: string): boolean {
  return (
    INVISIBLE_CONTROL_RE.test(text) ||
    MEMORY_BOUNDARY_RE.test(text) ||
    INSTRUCTION_OVERRIDE_RE.test(text) ||
    RUSSIAN_INSTRUCTION_OVERRIDE_RE.test(text)
  );
}
