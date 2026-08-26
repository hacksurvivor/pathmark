import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditMemory } from "./audit.js";
import { consolidateMemory } from "./consolidate.js";
import { recordRecallFeedback } from "./feedback.js";
import { loadConfig } from "./config.js";
import { answerMemory } from "./memory-query.js";
import { redactSecrets } from "./redact.js";
import { decryptPortableExport } from "./portable.js";
import { namespaceTag, PathmarkStore } from "./store.js";
const USAGE = [
    "Usage:",
    "  pathmark chat QUESTION [--namespace=NAME] [--tag=TAG] [--limit=N] [--kind=memory|conclusion]",
    "  pathmark feedback --recall-id=ID [--relevant=ID] [--irrelevant=ID] [--note=TEXT]",
    "  pathmark consolidate [--days=N] [--namespace=NAME] [--tag=TAG] [--limit=N] [--cursor=ID] [--max-proposals=N] [--apply]",
    "  pathmark audit [--days=N] [--namespace=NAME] [--tag=TAG]",
    "  pathmark doctor",
    "  pathmark compact [--apply] [--retention-days=N] [--keep-deleted] [--no-dedupe]",
    "  pathmark backup [--output=FILE]",
    "  pathmark export [--output=FILE] [--namespace=NAME] [--tag=TAG] [--kind=memory|conclusion] [--encrypted]",
    "  pathmark import FILE [--namespace=NAME] [--dry-run]",
    "  pathmark ingest --client=NAME [--namespace=NAME] [--dry-run] < transcript.json",
    "  pathmark purge [--id=ID] [--namespace=NAME] [--tag=TAG] [--source=SOURCE] [--before=ISO] [--apply]",
].join("\n");
export async function runManagementCommand(command, args) {
    const config = loadConfig();
    const store = new PathmarkStore(config);
    const options = parseOptions(args);
    if (command === "chat") {
        const question = option(options, "question") ?? options.positionals.join(" ").trim();
        if (!question)
            throw new Error(`Chat requires a question.\n${USAGE}`);
        const kind = option(options, "kind");
        if (kind && kind !== "memory" && kind !== "conclusion")
            throw new Error("--kind must be memory or conclusion");
        console.log(JSON.stringify(await answerMemory(store, config, question, {
            limit: numberOption(options, "limit", config.maxSearchResults),
            tags: scopedTags(options.values.get("tag") ?? [], option(options, "namespace")),
            kind: kind,
        }), null, 2));
        return;
    }
    if (command === "feedback") {
        const recallId = option(options, "recall-id") ?? options.positionals[0];
        if (!recallId)
            throw new Error(`Feedback requires --recall-id=ID.\n${USAGE}`);
        console.log(JSON.stringify(await recordRecallFeedback(store, config, {
            recallId,
            relevantIds: options.values.get("relevant"),
            irrelevantIds: options.values.get("irrelevant"),
            note: option(options, "note"),
        }), null, 2));
        return;
    }
    if (command === "consolidate") {
        console.log(JSON.stringify(await consolidateMemory(store, config, {
            days: numberOption(options, "days", 90),
            evidenceLimit: numberOption(options, "limit", 24),
            maxProposals: numberOption(options, "max-proposals", 5),
            cursor: option(options, "cursor"),
            tags: scopedTags(options.values.get("tag") ?? [], option(options, "namespace")),
            apply: options.flags.has("apply"),
        }), null, 2));
        return;
    }
    if (command === "audit") {
        console.log(JSON.stringify(await auditMemory(store, {
            days: numberOption(options, "days", 30),
            tags: scopedTags(options.values.get("tag") ?? [], option(options, "namespace")),
            rawRecallDays: config.codexRawRecallDays,
            rawRecallLimit: config.codexRawRecallLimit,
        }), null, 2));
        return;
    }
    if (command === "doctor") {
        console.log(JSON.stringify(await store.diagnose(), null, 2));
        return;
    }
    if (command === "compact") {
        console.log(JSON.stringify(await store.compact({
            dedupe: !options.flags.has("no-dedupe"),
            dropDeleted: !options.flags.has("keep-deleted"),
            retentionDays: numberOption(options, "retention-days", config.retentionDays),
            dryRun: !options.flags.has("apply"),
        }), null, 2));
        return;
    }
    if (command === "backup") {
        console.log(JSON.stringify({ file: await store.backup(option(options, "output")) }, null, 2));
        return;
    }
    if (command === "export") {
        const destination = option(options, "output") ?? defaultExportFile();
        const kind = option(options, "kind");
        if (kind && kind !== "memory" && kind !== "conclusion")
            throw new Error("--kind must be memory or conclusion");
        console.log(JSON.stringify(await store.exportTo(destination, {
            namespace: option(options, "namespace"),
            tags: options.values.get("tag"),
            kind: kind,
            includeDeleted: options.flags.has("include-deleted"),
            encrypted: options.flags.has("encrypted"),
        }), null, 2));
        return;
    }
    if (command === "purge") {
        console.log(JSON.stringify(await store.purge({
            id: option(options, "id"),
            namespace: option(options, "namespace"),
            tags: options.values.get("tag"),
            source: option(options, "source"),
            before: option(options, "before"),
            dryRun: !options.flags.has("apply"),
        }), null, 2));
        return;
    }
    if (command === "import") {
        const inputFile = options.positionals[0];
        if (!inputFile)
            throw new Error(`Import requires a JSONL file.\n${USAGE}`);
        const drafts = await importDrafts(inputFile, option(options, "namespace"), config.redactMcpWrites, config.exportEncryptionKey);
        if (options.flags.has("dry-run")) {
            console.log(JSON.stringify({ applied: false, recordCount: drafts.length }, null, 2));
            return;
        }
        const backupFile = await store.backup();
        const results = await store.addRecords(drafts, { dedupe: true });
        console.log(JSON.stringify({ applied: true, imported: results.filter((result) => result.created).length, skipped: results.filter((result) => !result.created).length, backupFile }, null, 2));
        return;
    }
    if (command === "ingest") {
        const client = option(options, "client");
        if (!client)
            throw new Error(`Ingest requires --client=NAME.\n${USAGE}`);
        const raw = await readStdin();
        const drafts = transcriptDrafts(raw, client, option(options, "namespace"), config.redactMcpWrites);
        if (options.flags.has("dry-run")) {
            console.log(JSON.stringify({ applied: false, recordCount: drafts.length }, null, 2));
            return;
        }
        const results = await store.addRecords(drafts, { dedupe: true });
        console.log(JSON.stringify({ applied: true, imported: results.filter((result) => result.created).length, skipped: results.filter((result) => !result.created).length }, null, 2));
        return;
    }
    throw new Error(USAGE);
}
function parseOptions(args) {
    const parsed = { flags: new Set(), values: new Map(), positionals: [] };
    for (const arg of args) {
        if (!arg.startsWith("--")) {
            parsed.positionals.push(arg);
            continue;
        }
        const [name, value] = arg.slice(2).split("=", 2);
        if (value === undefined)
            parsed.flags.add(name);
        else
            parsed.values.set(name, [...(parsed.values.get(name) ?? []), value]);
    }
    return parsed;
}
function option(options, name) {
    return options.values.get(name)?.at(-1);
}
function numberOption(options, name, fallback) {
    const raw = option(options, name);
    if (raw === undefined)
        return fallback;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 0)
        throw new Error(`--${name} must be a non-negative integer`);
    return value;
}
function defaultExportFile() {
    return path.resolve(`pathmark-export-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
}
async function importDrafts(file, namespace, redact, encryptionKey) {
    const raw = await decryptPortableExport(await readFile(path.resolve(file), "utf8"), encryptionKey);
    const drafts = [];
    for (const [index, line] of raw.split("\n").entries()) {
        if (!line.trim())
            continue;
        let value;
        try {
            value = JSON.parse(line);
        }
        catch {
            throw new Error(`Invalid JSON on line ${index + 1}`);
        }
        if (!isObject(value) || (value.kind !== "memory" && value.kind !== "conclusion") || typeof value.text !== "string") {
            throw new Error(`Invalid Pathmark record on line ${index + 1}`);
        }
        drafts.push({
            id: typeof value.id === "string" ? value.id : undefined,
            kind: value.kind,
            text: redact ? redactSecrets(value.text).text : value.text,
            tags: scopedTags(Array.isArray(value.tags) ? value.tags.filter((tag) => typeof tag === "string") : [], namespace),
            source: typeof value.source === "string" ? value.source : "pathmark-import",
            createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
            updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
            expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : undefined,
            supersedes: typeof value.supersedes === "string" ? value.supersedes : undefined,
            activity: importedActivity(value.activity),
            approval: value.kind === "conclusion" ? importedApproval(value.approval) : undefined,
            evidenceIds: value.kind === "conclusion" && Array.isArray(value.evidenceIds)
                ? value.evidenceIds.filter((id) => typeof id === "string" && Boolean(id.trim()))
                : undefined,
        });
    }
    return drafts;
}
function importedApproval(value) {
    if (!isObject(value))
        return undefined;
    if (value.status !== "pending" && value.status !== "approved" && value.status !== "rejected")
        return undefined;
    if (typeof value.proposedAt !== "string" || !value.proposedAt.trim())
        return undefined;
    if (!optionalStrings(value, ["decidedAt", "decidedBy", "note"]))
        return undefined;
    return {
        status: value.status,
        proposedAt: value.proposedAt,
        ...(typeof value.decidedAt === "string" ? { decidedAt: value.decidedAt } : {}),
        ...(typeof value.decidedBy === "string" ? { decidedBy: value.decidedBy } : {}),
        ...(typeof value.note === "string" ? { note: value.note } : {}),
    };
}
function importedActivity(value) {
    if (!isObject(value))
        return undefined;
    if (value.type === "recall" &&
        typeof value.queryHash === "string" &&
        Array.isArray(value.memoryIds) &&
        value.memoryIds.every((id) => typeof id === "string") &&
        Number.isInteger(value.memoryCount) &&
        Number(value.memoryCount) >= 0) {
        return value;
    }
    if (value.type === "recall_feedback" &&
        typeof value.recallId === "string" &&
        Array.isArray(value.relevantIds) &&
        value.relevantIds.every((id) => typeof id === "string") &&
        Array.isArray(value.irrelevantIds) &&
        value.irrelevantIds.every((id) => typeof id === "string") &&
        (value.note === undefined || typeof value.note === "string")) {
        return value;
    }
    if (value.type === "tool" &&
        typeof value.toolName === "string" &&
        (value.status === "success" || value.status === "error" || value.status === "unknown") &&
        (value.filesChanged === true || value.filesChanged === false || value.filesChanged === "unknown") &&
        optionalStrings(value, ["callId", "commandPreview", "commandHash", "inputPreview", "inputHash", "outputPreview", "outputHash"]) &&
        optionalNumbers(value, ["exitCode", "durationMs"]) &&
        (value.changedFiles === undefined || (Array.isArray(value.changedFiles) && value.changedFiles.every((file) => typeof file === "string")))) {
        return value;
    }
    return undefined;
}
function optionalStrings(value, keys) {
    return keys.every((key) => value[key] === undefined || typeof value[key] === "string");
}
function optionalNumbers(value, keys) {
    return keys.every((key) => value[key] === undefined || (typeof value[key] === "number" && Number.isFinite(value[key])));
}
function transcriptDrafts(raw, client, namespace, redact) {
    const parsed = JSON.parse(raw);
    const messages = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.messages) ? parsed.messages : [parsed];
    const now = new Date().toISOString();
    return messages.flatMap((message, index) => {
        if (!isObject(message))
            return [];
        const role = typeof message.role === "string" ? message.role.toLowerCase() : "unknown";
        const content = typeof message.text === "string" ? message.text : typeof message.content === "string" ? message.content : undefined;
        if (!content?.trim())
            return [];
        const text = redact ? redactSecrets(content).text : content;
        const session = typeof message.session_id === "string" ? message.session_id : typeof message.sessionId === "string" ? message.sessionId : "import";
        const at = typeof message.createdAt === "string" ? message.createdAt : typeof message.timestamp === "string" ? message.timestamp : now;
        return [
            {
                id: createHash("sha256").update(`${client}\0${session}\0${index}\0${text}`).digest("hex"),
                kind: "memory",
                text,
                tags: scopedTags(["transcript-import", `client:${client}`, `role-${role}`, `session:${session}`], namespace),
                source: `${client}:session:${session}`,
                createdAt: at,
                updatedAt: at,
            },
        ];
    });
}
function scopedTags(tags, namespace) {
    return [...new Set([...tags, ...(namespace ? [namespaceTag(namespace)] : [])])];
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw)
        throw new Error("No transcript JSON received on stdin");
    return raw;
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=manage.js.map