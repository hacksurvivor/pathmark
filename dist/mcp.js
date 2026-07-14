import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { synthesizeWithCommand } from "./chat.js";
import { loadConfig } from "./config.js";
import { jsonText, publicConfig, summarizeRecords, summarizeSearch, usedMemories } from "./format.js";
import { redactSecrets } from "./redact.js";
import { namespaceTag, PathmarkStore } from "./store.js";
export async function runMcpServer() {
    const config = loadConfig();
    const store = new PathmarkStore(config);
    const server = new McpServer({
        name: "pathmark",
        version: "0.1.7",
    });
    server.registerTool("get_config", {
        title: "Get Pathmark configuration",
        description: "Show the local Pathmark Memory store location and enabled optional features.",
        inputSchema: {},
    }, async () => jsonText(publicConfig(config)));
    server.registerTool("remember", {
        title: "Remember",
        description: "Save a durable local memory item.",
        inputSchema: {
            text: z.string().min(1).describe("Memory text to save."),
            tags: z.array(z.string()).optional().describe("Optional lowercase-ish tags for later filtering."),
            source: z.string().optional().describe("Optional source label, such as repo, thread, or tool name."),
            namespace: z.string().min(1).optional().describe("Optional project, user, or client namespace."),
            expiresAt: z.string().optional().describe("Optional ISO timestamp after which recall excludes this memory."),
        },
    }, async ({ text, tags, source, namespace, expiresAt }) => {
        const record = await store.add({
            kind: "memory",
            text: safeWriteText(text, config.redactMcpWrites),
            tags: scopedTags(tags, namespace ?? config.defaultNamespace),
            source,
            expiresAt,
        }, { dedupe: true });
        return jsonText(record);
    });
    server.registerTool("create_conclusion", {
        title: "Create conclusion",
        description: "Save a durable conclusion or preference that should be treated as higher-signal than raw memory.",
        inputSchema: {
            text: z.string().min(1).describe("Conclusion text to save."),
            tags: z.array(z.string()).optional(),
            source: z.string().optional(),
            namespace: z.string().min(1).optional(),
            expiresAt: z.string().optional(),
        },
    }, async ({ text, tags, source, namespace, expiresAt }) => {
        const record = await store.add({
            kind: "conclusion",
            text: safeWriteText(text, config.redactMcpWrites),
            tags: scopedTags(tags, namespace ?? config.defaultNamespace),
            source,
            expiresAt,
        }, { dedupe: true });
        return jsonText(record);
    });
    server.registerTool("search_memory", {
        title: "Search memory",
        description: "Search saved local memories and conclusions.",
        inputSchema: {
            query: z.string().default("").describe("Search query. Empty query returns recent records."),
            limit: z.number().int().min(1).max(50).optional(),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
            kind: z.enum(["memory", "conclusion"]).optional(),
        },
    }, async ({ query, limit, tags, namespace, kind }) => {
        const results = await store.search({ query, limit, tags: scopedTags(tags, namespace ?? config.defaultNamespace), kind });
        return jsonText({
            results: results.map((result) => ({
                ...result.record,
                score: result.score,
                matchedTerms: result.matchedTerms,
            })),
            summary: summarizeSearch(results),
            usedMemories: usedMemories(results),
        });
    });
    server.registerTool("get_context", {
        title: "Get context",
        description: "Return compact local memory context for a task or question.",
        inputSchema: {
            query: z.string().default("").describe("Task or question to retrieve context for."),
            limit: z.number().int().min(1).max(30).optional(),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
            kind: z.enum(["memory", "conclusion"]).optional(),
        },
    }, async ({ query, limit, tags, namespace, kind }) => {
        const results = await store.search({ query, limit, tags: scopedTags(tags, namespace ?? config.defaultNamespace), kind });
        return jsonText({
            context: summarizeSearch(results),
            usedMemories: usedMemories(results),
            records: results.map((result) => result.record),
        });
    });
    server.registerTool("recall_memory", {
        title: "Recall memory",
        description: "Transparent recall for any MCP-capable harness. Use this at task start or before answering to show exactly which memories were used.",
        inputSchema: {
            query: z.string().default("").describe("Task, repo, or question to retrieve memory for. Empty query returns recent records."),
            limit: z.number().int().min(1).max(30).optional(),
            tags: z.array(z.string()).optional().describe("Optional tags to scope visible recall, such as the current workspace tag."),
            namespace: z.string().min(1).optional(),
            kind: z.enum(["memory", "conclusion"]).optional(),
        },
    }, async ({ query, limit, tags, namespace, kind }) => {
        const results = await store.search({ query, limit, tags: scopedTags(tags, namespace ?? config.defaultNamespace), kind });
        return jsonText({
            mode: "transparent_recall",
            context: summarizeSearch(results),
            usedMemories: usedMemories(results),
            records: results.map((result) => result.record),
        });
    });
    server.registerTool("list_conclusions", {
        title: "List conclusions",
        description: "List saved durable conclusions.",
        inputSchema: {
            limit: z.number().int().min(1).max(100).optional(),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
        },
    }, async ({ limit, tags, namespace }) => {
        const scope = scopedTags(tags, namespace ?? config.defaultNamespace);
        const records = (scope.length > 0
            ? await store.recordsWithTags(scope, { kind: "conclusion", limit: limit ?? 50 })
            : await store.all({ kind: "conclusion" })).slice(0, limit ?? 50);
        return jsonText({
            records,
            summary: summarizeRecords(records),
        });
    });
    server.registerTool("delete_memory", {
        title: "Delete memory",
        description: "Soft-delete a saved memory or conclusion by id.",
        inputSchema: {
            id: z.string().min(1),
        },
    }, async ({ id }) => {
        const deleted = await store.delete(id);
        return jsonText({ deleted: deleted ?? null });
    });
    server.registerTool("update_memory", {
        title: "Update memory",
        description: "Correct an existing memory while preserving its prior versions in local history.",
        inputSchema: {
            id: z.string().min(1),
            text: z.string().min(1).optional(),
            tags: z.array(z.string()).optional(),
            source: z.string().optional(),
            namespace: z.string().min(1).optional(),
            expiresAt: z.string().nullable().optional(),
        },
    }, async ({ id, text, tags, source, namespace, expiresAt }) => {
        const selectedNamespace = namespace ?? config.defaultNamespace;
        const existing = tags === undefined && selectedNamespace ? await store.get(id) : undefined;
        const scoped = tags === undefined && selectedNamespace === undefined
            ? undefined
            : scopedTags(tags ?? existing?.tags, selectedNamespace);
        const updated = await store.update(id, {
            ...(text === undefined ? {} : { text: safeWriteText(text, config.redactMcpWrites) }),
            ...(scoped === undefined ? {} : { tags: scoped }),
            ...(source === undefined ? {} : { source }),
            ...(expiresAt === undefined ? {} : { expiresAt }),
        });
        return jsonText({ updated: updated ?? null });
    });
    server.registerTool("supersede_memory", {
        title: "Supersede memory",
        description: "Replace an outdated memory with a linked current record while preserving history.",
        inputSchema: {
            id: z.string().min(1),
            text: z.string().min(1),
            kind: z.enum(["memory", "conclusion"]).default("memory"),
            tags: z.array(z.string()).optional(),
            source: z.string().optional(),
            namespace: z.string().min(1).optional(),
            expiresAt: z.string().optional(),
        },
    }, async ({ id, text, kind, tags, source, namespace, expiresAt }) => {
        const selectedNamespace = namespace ?? config.defaultNamespace;
        const existing = tags === undefined && selectedNamespace ? await store.get(id) : undefined;
        const replacementTags = tags === undefined && selectedNamespace === undefined
            ? undefined
            : scopedTags(tags ?? existing?.tags, selectedNamespace);
        const replacement = await store.supersede(id, {
            kind,
            text: safeWriteText(text, config.redactMcpWrites),
            tags: replacementTags,
            source,
            expiresAt,
        });
        return jsonText({ replacement: replacement ?? null });
    });
    server.registerTool("purge_memory", {
        title: "Hard purge memory",
        description: "Preview or permanently remove matching records from the canonical store. A backup is created before an applied purge.",
        inputSchema: {
            id: z.string().min(1).optional(),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
            source: z.string().optional(),
            before: z.string().optional(),
            confirm: z.boolean().default(false).describe("False previews the purge; true applies it and creates a backup."),
        },
    }, async ({ id, tags, namespace, source, before, confirm }) => jsonText(await store.purge({ id, tags, namespace, source, before, dryRun: !confirm })));
    server.registerTool("doctor_memory", {
        title: "Diagnose memory store",
        description: "Report duplicate, deleted, expired, conclusion, invalid-record, and index health counts without changing data.",
        inputSchema: {},
    }, async () => jsonText(await store.diagnose()));
    server.registerTool("compact_memory", {
        title: "Compact memory store",
        description: "Preview or apply exact deduplication, expired-record removal, retention, and deleted-record purging. Applied runs create a backup.",
        inputSchema: {
            dedupe: z.boolean().default(true),
            dropDeleted: z.boolean().default(true),
            retentionDays: z.number().int().min(0).optional(),
            confirm: z.boolean().default(false),
        },
    }, async ({ dedupe, dropDeleted, retentionDays, confirm }) => jsonText(await store.compact({ dedupe, dropDeleted, retentionDays, dryRun: !confirm })));
    server.registerTool("backup_memory", {
        title: "Back up memory store",
        description: "Create a point-in-time copy of the canonical local JSONL store.",
        inputSchema: { destination: z.string().min(1).optional() },
    }, async ({ destination }) => jsonText({ file: await store.backup(destination) }));
    server.registerTool("export_memory", {
        title: "Export memory",
        description: "Export a scoped, mergeable JSONL bundle for another Pathmark installation or trusted sync transport.",
        inputSchema: {
            destination: z.string().min(1),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
            kind: z.enum(["memory", "conclusion"]).optional(),
            includeDeleted: z.boolean().default(false),
            encrypted: z.boolean().default(false).describe("Encrypt the export with PATHMARK_EXPORT_KEY."),
        },
    }, async ({ destination, tags, namespace, kind, includeDeleted, encrypted }) => jsonText(await store.exportTo(destination, { tags, namespace, kind, includeDeleted, encrypted })));
    server.registerTool("ask_memory", {
        title: "Ask memory",
        description: "Retrieve relevant context and optionally synthesize an answer through PATHMARK_CHAT_COMMAND. Without a command, returns context for the MCP client to synthesize.",
        inputSchema: {
            question: z.string().min(1),
            limit: z.number().int().min(1).max(30).optional(),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
            kind: z.enum(["memory", "conclusion"]).optional(),
        },
    }, async ({ question, limit, tags, namespace, kind }) => answerFromMemory(question, limit, tags, namespace, kind));
    server.registerTool("chat", {
        title: "Chat",
        description: "Ask Pathmark memory a question. Returns the exact retrieved context so the MCP client can show what memory was used.",
        inputSchema: {
            question: z.string().min(1),
            limit: z.number().int().min(1).max(30).optional(),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
            kind: z.enum(["memory", "conclusion"]).optional(),
        },
    }, async ({ question, limit, tags, namespace, kind }) => answerFromMemory(question, limit, tags, namespace, kind));
    await store.ensureReady();
    await server.connect(new StdioServerTransport());
    async function answerFromMemory(question, limit, tags, namespace, kind) {
        const results = await store.search({
            query: question,
            limit,
            tags: scopedTags(tags, namespace ?? config.defaultNamespace),
            kind,
        });
        const answer = await synthesizeWithCommand({ config, question, context: results });
        return jsonText({
            answer: answer ?? null,
            synthesis: answer ? "server_command" : "client_should_synthesize",
            context: summarizeSearch(results),
            usedMemories: usedMemories(results),
            records: results.map((result) => result.record),
        });
    }
}
function scopedTags(tags, namespace) {
    return [...new Set([...(tags ?? []), ...(namespace ? [namespaceTag(namespace)] : [])])];
}
function safeWriteText(text, redact) {
    return redact ? redactSecrets(text).text : text;
}
//# sourceMappingURL=mcp.js.map