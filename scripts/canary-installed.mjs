import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const sessionId = process.argv.find((argument) => argument.startsWith("--session="))?.slice("--session=".length);
if (!sessionId) throw new Error("Usage: node scripts/canary-installed.mjs --session=<exact-session-id>");

const expectedVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const child = spawn("pathmark", [], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
let nextId = 1;
let stdout = "";
let stderr = "";
const pending = new Map();

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  let newline;
  while ((newline = stdout.indexOf("\n")) >= 0) {
    const line = stdout.slice(0, newline).trim();
    stdout = stdout.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

function request(method, params = {}) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}: ${stderr}`));
    }, 30_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
  });
}

try {
  const initialized = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "pathmark-installed-canary", version: expectedVersion },
  });
  assert.equal(initialized.serverInfo?.version, expectedVersion);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

  const tools = await request("tools/list");
  const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
  assert.equal(byName.has("session_trace"), true);
  for (const toolName of [
    "list_pending_conclusions",
    "approve_conclusion",
    "reject_conclusion",
    "get_memory_snapshot",
    "audit_memory",
  ]) {
    assert.equal(byName.has(toolName), true, `installed canary missing ${toolName}`);
  }
  assert.equal("ids" in (byName.get("recall_memory")?.inputSchema?.properties ?? {}), true);
  assert.equal("includeRecords" in (byName.get("recall_memory")?.inputSchema?.properties ?? {}), true);

  const traceResult = await request("tools/call", {
    name: "session_trace",
    arguments: { sessionId, limit: 100, includeOutputs: false },
  });
  const trace = JSON.parse(traceResult.content?.[0]?.text ?? "{}");
  assert.equal(trace.mode, "session_trace");
  assert.equal(trace.sessionId, sessionId);
  assert.equal(Array.isArray(trace.entries), true);
  assert.equal(trace.entries.length > 0, true, "installed canary session trace was empty");
  assert.equal(trace.entries.every((entry) => !("outputPreview" in entry)), true);
  const structuredTools = trace.entries.filter((entry) => entry.type === "tool" && typeof entry.status === "string");
  assert.equal(structuredTools.length > 0, true, "installed canary found no structured tool activity");
  assert.equal(structuredTools.some((entry) => typeof entry.exitCode === "number"), true, "no reconciled tool exit code");
  assert.equal(structuredTools.some((entry) => typeof entry.durationMs === "number"), true, "no reconciled tool duration");
  assert.equal(structuredTools.some((entry) => typeof entry.outputHash === "string"), true, "no tool output digest");
  const exactIds = trace.entries
    .map((entry) => entry.recordId)
    .filter((id) => typeof id === "string")
    .slice(0, 2);
  assert.equal(exactIds.length, 2, "installed canary found too few trace records for exact recall");
  const exactRecallResult = await request("tools/call", {
    name: "recall_memory",
    arguments: {
      query: "deliberately unrelated installed canary query",
      ids: exactIds,
      limit: exactIds.length,
      includeRecords: false,
    },
  });
  const exactRecall = JSON.parse(exactRecallResult.content?.[0]?.text ?? "{}");
  assert.equal(exactRecall.mode, "transparent_recall");
  assert.deepEqual(
    exactRecall.usedMemories.map((memory) => memory.id),
    exactIds,
    "installed exact recall did not preserve the pinned memory IDs",
  );
  assert.equal("records" in exactRecall, false, "compact exact recall returned the redundant records copy");

  console.log(
    JSON.stringify({
      version: initialized.serverInfo.version,
      toolCount: tools.tools.length,
      traceEntries: trace.entries.length,
      structuredTools: structuredTools.length,
      structuredStatuses: [...new Set(structuredTools.map((entry) => entry.status))],
      toolsWithExitCode: structuredTools.filter((entry) => typeof entry.exitCode === "number").length,
      toolsWithDuration: structuredTools.filter((entry) => typeof entry.durationMs === "number").length,
      toolsWithOutputHash: structuredTools.filter((entry) => typeof entry.outputHash === "string").length,
      exactRecallIds: exactIds.length,
      traceTypes: [...new Set(trace.entries.map((entry) => entry.type))],
    }),
  );
} finally {
  child.kill("SIGTERM");
}
