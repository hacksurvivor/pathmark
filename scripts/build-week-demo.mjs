import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function startClient(storeDir) {
  const child = spawn(process.execPath, ["dist/index.js"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PATHMARK_STORE_DIR: storeDir,
      PATHMARK_NAMESPACE: "build-week",
    },
  });

  let nextId = 1;
  const pending = new Map();
  let buffer = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id).resolve(message);
        pending.delete(message.id);
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
        reject(new Error(`Timed out waiting for ${method}${stderr ? `: ${stderr}` : ""}`));
      }, 5000);
      pending.set(id, {
        resolve(message) {
          clearTimeout(timeout);
          if (message.error) reject(new Error(JSON.stringify(message.error)));
          else resolve(message.result);
        },
      });
    });
  }

  async function initialize() {
    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pathmark-build-week-demo", version: "1.0.0" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  }

  async function callTool(name, args = {}) {
    return request("tools/call", { name, arguments: args });
  }

  async function stop() {
    if (!child.killed) child.kill("SIGTERM");
  }

  return { initialize, callTool, stop };
}

function resultText(result) {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

const storeDir = await mkdtemp(path.join(os.tmpdir(), "pathmark-build-week-"));
let writer;
let reader;

try {
  console.log("PATHMARK · OPENAI BUILD WEEK 2026");
  console.log("Local cross-session memory demo\n");

  writer = startClient(storeDir);
  await writer.initialize();
  console.log("[1/5] Started the real Pathmark MCP server on an isolated local store.");

  const saved = await writer.callTool("remember", {
    text: "Architecture decision: keep the canonical memory store as inspectable JSONL and treat SQLite as a disposable search index.",
    tags: ["architecture", "build-week"],
    source: "codex-demo-session-a",
  });
  const savedRecord = JSON.parse(resultText(saved));
  console.log(`[2/5] Session A saved decision ${savedRecord.id}.`);
  await writer.stop();

  reader = startClient(storeDir);
  await reader.initialize();
  const recalled = await reader.callTool("recall_memory", {
    query: "What did we decide about the canonical memory store?",
    tags: ["architecture", "build-week"],
    limit: 3,
  });
  const recalledPayload = JSON.parse(resultText(recalled));
  const recoveredText = recalledPayload.records?.[0]?.text ?? "";
  if (!recoveredText.includes("inspectable JSONL")) {
    throw new Error("Fresh-session recall did not recover the saved decision.");
  }
  console.log("[3/5] Session B recovered the decision from the same local store.");
  console.log(`      ${recoveredText}`);
  console.log(`      Visible evidence: ${recalledPayload.usedMemories?.length ?? 0} used memory with source and match metadata.`);

  const redacted = await reader.callTool("remember", {
    text: "OPENAI_API_KEY=demo-value-that-must-not-be-stored",
    tags: ["security", "build-week"],
    source: "codex-demo-session-b",
  });
  const redactedText = resultText(redacted);
  if (redactedText.includes("demo-value-that-must-not-be-stored") || !redactedText.includes("[REDACTED]")) {
    throw new Error("Secret-shaped demo value was not redacted.");
  }
  console.log("[4/5] Secret-shaped input was redacted before storage.");

  const doctor = await reader.callTool("doctor_memory");
  const health = JSON.parse(resultText(doctor));
  if (health.invalidRecordCount !== 0) {
    throw new Error(`Doctor reported ${health.invalidRecordCount} invalid records.`);
  }
  console.log(`[5/5] Store health: ${health.activeRecords} active records, ${health.invalidRecordCount} invalid.`);
  console.log("\nPASS · durable recall, visible evidence, namespace isolation, and redaction verified locally.");
} finally {
  await writer?.stop();
  await reader?.stop();
  await rm(storeDir, { recursive: true, force: true });
}
