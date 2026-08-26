import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../dist/config.js";
import { PathmarkStore } from "../dist/store.js";
import { sessionTrace } from "../dist/session-trace.js";
import { startWebMcpServer } from "../dist/webmcp.js";

const storeDir = await mkdtemp(path.join(os.tmpdir(), "pathmark-webmcp-test-"));
const originalStoreDir = process.env.PATHMARK_STORE_DIR;
process.env.PATHMARK_STORE_DIR = storeDir;

const config = loadConfig();
const store = new PathmarkStore(config);
let server;

try {
  const at = new Date().toISOString();
  await store.add({
    id: "webmcp-evidence",
    kind: "memory",
    text: "The browser memory experience should stay quiet, local, and provenance-first.",
    tags: ["workspace:webmcp", "role-user"],
    source: "webmcp-test",
    createdAt: at,
    updatedAt: at,
  });
  await store.add({
    id: "webmcp-conclusion",
    kind: "conclusion",
    text: "Use a quiet local browser memory experience with visible provenance.",
    tags: ["workspace:webmcp"],
    source: "webmcp-test",
    createdAt: at,
    updatedAt: at,
    evidenceIds: ["webmcp-evidence"],
    approval: { status: "approved", proposedAt: at, decidedAt: at, decidedBy: "test" },
  });

  server = await startWebMcpServer({ port: 0, tags: ["workspace:webmcp"], config });
  const pageResponse = await fetch(server.url);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(pageResponse.headers.get("permissions-policy"), "tools=(self)");
  const page = await pageResponse.text();
  assert.match(page, /document\.modelContext\.registerTool/);
  assert.match(page, /name: 'pathmark_recall_memory'/);
  assert.match(page, /name: 'pathmark_ask_memory'/);
  assert.match(page, /name: 'pathmark_rate_recall'/);
  assert.match(page, /readOnlyHint: true, untrustedContentHint: true/);
  assert.doesNotMatch(page, /pathmark_(?:remember|create|approve|delete)_/);

  const bootMatch = page.match(/const boot = (\{[^;]+\});/);
  assert.ok(bootMatch, "WebMCP page did not embed its per-process token");
  const boot = JSON.parse(bootMatch[1]);
  const sessionId = `webmcp-${randomUUID()}`;
  const api = async (route, input, origin = server.url, token = boot.token) => fetch(`${server.url}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "X-Pathmark-WebMCP-Token": token,
    },
    body: JSON.stringify({ sessionId, callId: randomUUID(), input }),
  });

  const health = await (await fetch(`${server.url}/api/health`)).json();
  assert.deepEqual(health.tools, ["pathmark_recall_memory", "pathmark_ask_memory", "pathmark_rate_recall"]);

  const recallResponse = await api("/api/recall", { query: "quiet browser memory visible provenance" });
  assert.equal(recallResponse.status, 200);
  const recall = await recallResponse.json();
  assert.equal(recall.usedMemories[0].id, "webmcp-conclusion");
  assert.equal(typeof recall.recallId, "string");

  const askResponse = await api("/api/ask", { question: "How should browser memory behave?" });
  assert.equal(askResponse.status, 200);
  const answer = await askResponse.json();
  assert.equal(answer.answer, "Use a quiet local browser memory experience with visible provenance.");
  assert.equal(answer.retrievalMode, "conclusion");
  assert.equal("records" in answer, false);

  const rateResponse = await api("/api/rate", { recallId: recall.recallId, relevantIds: ["webmcp-conclusion"] });
  assert.equal(rateResponse.status, 200);
  const rating = await rateResponse.json();
  assert.deepEqual(rating.relevantIds, ["webmcp-conclusion"]);

  assert.equal((await api("/api/ask", { question: "test" }, "http://evil.example")).status, 403);
  assert.equal((await api("/api/ask", { question: "test" }, server.url, "wrong-token")).status, 403);
  assert.equal((await api("/api/rate", { recallId: recall.recallId, relevantIds: ["not-recalled"] })).status, 400);

  let trace;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    trace = await sessionTrace(store, sessionId, { includeOutputs: false });
    if (trace.entries.filter((entry) => entry.type === "tool" && entry.toolName?.startsWith("webmcp:pathmark_")).length >= 3) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(trace.entries.some((entry) => entry.type === "recall"), true);
  const toolEntries = trace.entries.filter((entry) => entry.type === "tool" && entry.toolName?.startsWith("webmcp:pathmark_"));
  assert.equal(toolEntries.length >= 3, true);
  assert.equal(toolEntries.every((entry) => entry.inputPreview.includes(server.url)), true);
  assert.equal(toolEntries.every((entry) => typeof entry.inputHash === "string"), true);
  assert.equal(toolEntries.every((entry) => typeof entry.outputHash === "string"), true);

  console.log("WebMCP lab tests passed");
} finally {
  if (server) await server.close();
  await store.close();
  if (originalStoreDir === undefined) delete process.env.PATHMARK_STORE_DIR;
  else process.env.PATHMARK_STORE_DIR = originalStoreDir;
  await rm(storeDir, { recursive: true, force: true });
}
