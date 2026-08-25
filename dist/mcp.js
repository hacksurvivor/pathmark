import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { auditMemory } from "./audit.js";
import { synthesizeWithCommand } from "./chat.js";
import { loadConfig } from "./config.js";
import { jsonText, publicConfig, summarizeRecords, summarizeSearch, usedMemories } from "./format.js";
import { redactSecrets } from "./redact.js";
import { selectRelevantResults } from "./relevance.js";
import { namespaceTag, PathmarkStore } from "./store.js";
import { sessionTrace } from "./session-trace.js";
import { buildMemorySnapshot } from "./snapshot.js";
import { conclusionApprovalStatus } from "./approval.js";
export async function runMcpServer() {
    const config = loadConfig();
    const store = new PathmarkStore(config);
    const server = new McpServer({
        name: "pathmark",
        version: "0.1.10",
    });
    server.registerTool("get_config", {
        title: "Get Pathmark configuration",
        description: "Show the local Pathmark Memory store location and enabled optional features.",
        inputSchema: {},
    }, async () => jsonText(publicConfig(config)));
    server.registerTool("remember", {
        title: "Save raw evidence",
        description: "Save raw searchable evidence. Durable intent should use the approval-gated conclusion workflow.",
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
        description: "Propose a durable higher-signal conclusion. Approval is required by default before it can be recalled.",
        inputSchema: {
            text: z.string().min(1).describe("Conclusion text to save."),
            tags: z.array(z.string()).optional(),
            source: z.string().optional(),
            namespace: z.string().min(1).optional(),
            expiresAt: z.string().optional(),
        },
    }, async ({ text, tags, source, namespace, expiresAt }) => {
        const input = {
            text: safeWriteText(text, config.redactMcpWrites),
            tags: scopedTags(tags, namespace ?? config.defaultNamespace),
            source,
            expiresAt,
        };
        if (config.conclusionApprovalRequired) {
            const { record, created } = await store.proposeConclusion(input, { dedupe: true });
            const approval = conclusionApprovalStatus(record);
            return jsonText({
                status: approval === "pending" ? "pending_approval" : "already_approved",
                created,
                proposal: record,
            });
        }
        const decidedAt = new Date().toISOString();
        const record = await store.add({
            ...input,
            kind: "conclusion",
            approval: { status: "approved", proposedAt: decidedAt, decidedAt, decidedBy: "approval-disabled" },
        }, { dedupe: true });
        return jsonText({ status: "approved", record });
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
        const results = await relevantSearch(query, limit, scopedTags(tags, namespace ?? config.defaultNamespace), kind);
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
            ids: z
                .array(z.string().min(1))
                .min(1)
                .max(30)
                .optional()
                .describe("Exact memory IDs from a prior Pathmark context block. Preserves the original visible-recall set."),
            tags: z.array(z.string()).optional().describe("Optional tags to scope visible recall, such as the current workspace tag."),
            namespace: z.string().min(1).optional(),
            kind: z.enum(["memory", "conclusion"]).optional(),
            includeRecords: z
                .boolean()
                .optional()
                .describe("Include a second, untruncated full-record copy alongside usedMemories. Defaults to false: it duplicates data already in context/usedMemories and is unbounded in size. Set true only when full record bodies are required."),
        },
    }, async ({ query, limit, ids, tags, namespace, kind, includeRecords }) => {
        const scoped = scopedTags(tags, namespace ?? config.defaultNamespace);
        const selectedLimit = limit ?? config.maxSearchResults;
        const results = ids
            ? (await store.searchByIds({ ids, query, tags: scoped, kind })).slice(0, selectedLimit)
            : await relevantSearch(query, limit, scoped, kind);
        return jsonText({
            mode: "transparent_recall",
            context: summarizeSearch(results),
            usedMemories: usedMemories(results),
            ...(includeRecords === true ? { records: results.map((result) => result.record) } : {}),
        });
    });
    server.registerTool("session_trace", {
        title: "Session trace",
        description: "Show a bounded chronological audit trail for one captured session: prompts, exact injected memory IDs, redacted tool inputs/results, and answers.",
        inputSchema: {
            sessionId: z.string().min(1).describe("Exact Codex or harness session ID."),
            limit: z.number().int().min(1).max(500).optional(),
            includeOutputs: z.boolean().optional().describe("Include redacted bounded tool output previews. Defaults to true."),
        },
    }, async ({ sessionId, limit, includeOutputs }) => jsonText(await sessionTrace(store, sessionId, { limit, includeOutputs })));
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
        const records = await store.listConclusions({ status: "approved", tags: scope, limit: limit ?? 50 });
        return jsonText({
            records,
            summary: summarizeRecords(records),
        });
    });
    server.registerTool("list_pending_conclusions", {
        title: "List pending conclusions",
        description: "List bounded approval-gated conclusion proposals. Pending records are never returned by normal memory search.",
        inputSchema: {
            limit: z.number().int().min(1).max(100).optional(),
            offset: z.number().int().min(0).max(1_000_000).optional(),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ limit, offset, tags, namespace }) => {
        const selectedLimit = limit ?? 50;
        const records = await store.listConclusions({
            status: "pending",
            tags: scopedTags(tags, namespace ?? config.defaultNamespace),
            limit: selectedLimit + 1,
            offset,
        });
        return jsonText({
            records: records.slice(0, selectedLimit),
            pagination: { offset: offset ?? 0, limit: selectedLimit, hasMore: records.length > selectedLimit },
        });
    });
    server.registerTool("approve_conclusion", {
        title: "Approve conclusion",
        description: "Approve one pending conclusion, optionally correcting its text or tags. The transition is atomic and auditable.",
        inputSchema: {
            id: z.string().min(1),
            text: z.string().min(1).optional(),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
            decidedBy: z.string().min(1).max(200).optional(),
            note: z.string().max(1_000).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ id, text, tags, namespace, decidedBy, note }) => {
        const existing = await store.get(id);
        const selectedNamespace = namespace ?? config.defaultNamespace;
        const approvalTags = tags === undefined && namespace === undefined
            ? undefined
            : scopedTags(tags ?? existing?.tags, selectedNamespace);
        const approved = await store.decideConclusion(id, "approved", {
            ...(text === undefined ? {} : { text: safeWriteText(text, config.redactMcpWrites) }),
            ...(approvalTags === undefined ? {} : { tags: approvalTags }),
            decidedBy,
            note,
        });
        return jsonText({ approved: approved ?? null });
    });
    server.registerTool("reject_conclusion", {
        title: "Reject conclusion",
        description: "Reject one pending conclusion while retaining it in the canonical audit trail and excluding it from recall.",
        inputSchema: {
            id: z.string().min(1),
            decidedBy: z.string().min(1).max(200).optional(),
            note: z.string().max(1_000).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ id, decidedBy, note }) => jsonText({ rejected: (await store.decideConclusion(id, "rejected", { decidedBy, note })) ?? null }));
    server.registerTool("get_memory_snapshot", {
        title: "Get approved memory snapshot",
        description: "Generate a bounded USER/PROJECT/AGENT snapshot from approved canonical conclusions only.",
        inputSchema: {
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
            charLimit: z.number().int().min(500).max(12_000).optional(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ tags, namespace, charLimit }) => jsonText(await buildMemorySnapshot(store, {
        scopeTags: scopedTags(tags, namespace ?? config.defaultNamespace),
        charLimit: charLimit ?? config.snapshotCharLimit,
    })));
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
        const replacementInput = {
            kind,
            text: safeWriteText(text, config.redactMcpWrites),
            tags: replacementTags,
            source,
            expiresAt,
        };
        if (kind === "conclusion" && config.conclusionApprovalRequired) {
            const existingRecord = await store.get(id);
            if (!existingRecord)
                return jsonText({ status: "not_found", proposal: null });
            const { record, created } = await store.proposeConclusion({ ...replacementInput, tags: replacementTags ?? existingRecord.tags, supersedes: id }, { dedupe: true });
            return jsonText({
                status: conclusionApprovalStatus(record) === "pending" ? "pending_approval" : "already_approved",
                created,
                proposal: record,
            });
        }
        const replacement = await store.supersede(id, replacementInput);
        return jsonText({ status: replacement ? "superseded" : "not_found", replacement: replacement ?? null });
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
    server.registerTool("audit_memory", {
        title: "Audit memory value",
        description: "Measure capture-to-recall behavior, unused records, recall age, duplicate rate, stale raw hits, and available precision evidence without changing memory.",
        inputSchema: {
            days: z.number().int().min(0).max(3_650).optional(),
            tags: z.array(z.string()).optional(),
            namespace: z.string().min(1).optional(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ days, tags, namespace }) => jsonText(await auditMemory(store, {
        days,
        tags: scopedTags(tags, namespace ?? config.defaultNamespace),
        rawRecallDays: config.codexRawRecallDays,
        rawRecallLimit: config.codexRawRecallLimit,
    })));
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
        const results = await relevantSearch(question, limit, scopedTags(tags, namespace ?? config.defaultNamespace), kind);
        const answer = await synthesizeWithCommand({ config, question, context: results });
        return jsonText({
            answer: answer ?? null,
            synthesis: answer ? "server_command" : "client_should_synthesize",
            context: summarizeSearch(results),
            usedMemories: usedMemories(results),
            records: results.map((result) => result.record),
        });
    }
    async function relevantSearch(query, limit, tags, kind) {
        const selectedLimit = limit ?? config.maxSearchResults;
        const candidateLimit = query.trim() ? Math.min(50, Math.max(20, selectedLimit * 4)) : selectedLimit;
        const candidates = (await store.search({ query, limit: candidateLimit, tags, kind }))
            .filter((result) => !result.record.tags.includes("pathmark-activity"));
        return query.trim() ? selectRelevantResults(candidates, query, selectedLimit) : candidates.slice(0, selectedLimit);
    }
}
function scopedTags(tags, namespace) {
    return [...new Set([...(tags ?? []), ...(namespace ? [namespaceTag(namespace)] : [])])];
}
function safeWriteText(text, redact) {
    return redact ? redactSecrets(text).text : text;
}
//# sourceMappingURL=mcp.js.map