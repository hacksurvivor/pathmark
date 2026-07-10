import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { synthesizeWithCommand } from "./chat.js";
import { loadConfig } from "./config.js";
import { jsonText, publicConfig, summarizeRecords, summarizeSearch, usedMemories } from "./format.js";
import { PathmarkStore } from "./store.js";
export async function runMcpServer() {
    const config = loadConfig();
    const store = new PathmarkStore(config);
    const server = new McpServer({
        name: "pathmark",
        version: "0.1.5",
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
        },
    }, async ({ text, tags, source }) => {
        const record = await store.add({ kind: "memory", text, tags, source });
        return jsonText(record);
    });
    server.registerTool("create_conclusion", {
        title: "Create conclusion",
        description: "Save a durable conclusion or preference that should be treated as higher-signal than raw memory.",
        inputSchema: {
            text: z.string().min(1).describe("Conclusion text to save."),
            tags: z.array(z.string()).optional(),
            source: z.string().optional(),
        },
    }, async ({ text, tags, source }) => {
        const record = await store.add({ kind: "conclusion", text, tags, source });
        return jsonText(record);
    });
    server.registerTool("search_memory", {
        title: "Search memory",
        description: "Search saved local memories and conclusions.",
        inputSchema: {
            query: z.string().default("").describe("Search query. Empty query returns recent records."),
            limit: z.number().int().min(1).max(50).optional(),
            tags: z.array(z.string()).optional(),
            kind: z.enum(["memory", "conclusion"]).optional(),
        },
    }, async ({ query, limit, tags, kind }) => {
        const results = await store.search({ query, limit, tags, kind });
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
        },
    }, async ({ query, limit }) => {
        const results = await store.search({ query, limit });
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
        },
    }, async ({ query, limit, tags }) => {
        const results = await store.search({ query, limit, tags });
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
        },
    }, async ({ limit }) => {
        const records = (await store.all({ kind: "conclusion" })).slice(0, limit ?? 50);
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
    server.registerTool("ask_memory", {
        title: "Ask memory",
        description: "Retrieve relevant context and optionally synthesize an answer through PATHMARK_CHAT_COMMAND. Without a command, returns context for the MCP client to synthesize.",
        inputSchema: {
            question: z.string().min(1),
            limit: z.number().int().min(1).max(30).optional(),
        },
    }, async ({ question, limit }) => answerFromMemory(question, limit));
    server.registerTool("chat", {
        title: "Chat",
        description: "Ask Pathmark memory a question. Returns the exact retrieved context so the MCP client can show what memory was used.",
        inputSchema: {
            question: z.string().min(1),
            limit: z.number().int().min(1).max(30).optional(),
        },
    }, async ({ question, limit }) => answerFromMemory(question, limit));
    await store.ensureReady();
    await server.connect(new StdioServerTransport());
    async function answerFromMemory(question, limit) {
        const results = await store.search({ query: question, limit });
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
//# sourceMappingURL=mcp.js.map