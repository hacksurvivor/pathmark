const ENV_SECRET_RE = /\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*[:=]\s*)(?:"[\s\S]*?(?:"|$)|'[\s\S]*?(?:'|$)|[^\s'",;}]+)/gi;
const ENV_URL_OR_DSN_RE = /\b([A-Z0-9_]*(?:DATABASE_URL|REDIS_URL|MONGO_URL|DSN|[A-Z0-9_]+_URL)[A-Z0-9_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s'",;}]+)/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const STANDALONE_OPENAI_KEY_RE = /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g;
const CREDENTIAL_URL_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/i;
const PEM_PRIVATE_KEY_RE = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/gi;
export function redactSecrets(text) {
    let redacted = false;
    const safeText = text
        .replace(PEM_PRIVATE_KEY_RE, () => {
        redacted = true;
        return "[REDACTED PRIVATE KEY]";
    })
        .replace(ENV_SECRET_RE, (_match, prefix) => {
        redacted = true;
        return `${prefix}[REDACTED]`;
    })
        .replace(ENV_URL_OR_DSN_RE, (match, name, separator, value) => {
        const normalizedName = name.toUpperCase();
        const unquotedValue = value.replace(/^(['"])([\s\S]*)\1$/, "$2");
        const isDsn = normalizedName.includes("DSN");
        const isUrlName = normalizedName.includes("DATABASE_URL") ||
            normalizedName.includes("REDIS_URL") ||
            normalizedName.includes("MONGO_URL") ||
            normalizedName.includes("_URL");
        if (!isDsn && (!isUrlName || !CREDENTIAL_URL_RE.test(unquotedValue)))
            return match;
        redacted = true;
        return `${name}${separator}[REDACTED]`;
    })
        .replace(BEARER_RE, () => {
        redacted = true;
        return "Bearer [REDACTED]";
    })
        .replace(STANDALONE_OPENAI_KEY_RE, () => {
        redacted = true;
        return "[REDACTED]";
    });
    return { text: safeText, redacted };
}
//# sourceMappingURL=redact.js.map