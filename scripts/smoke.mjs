import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const storeDir = await mkdtemp(path.join(os.tmpdir(), "pathmark-smoke-"));
const child = spawn(process.execPath, ["dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    PATHMARK_STORE_DIR: storeDir,
  },
});

let nextId = 1;
const pending = new Map();
let buffer = "";

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
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

function request(method, params = {}) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 5000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
  });
}

await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: {
    name: "pathmark-smoke",
    version: "0.1.0",
  },
});
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

const tools = await request("tools/list");
const toolNames = tools.tools.map((tool) => tool.name);
for (const required of [
  "remember",
  "create_conclusion",
  "search_memory",
  "recall_memory",
  "session_trace",
  "get_context",
  "list_conclusions",
  "list_pending_conclusions",
  "approve_conclusion",
  "reject_conclusion",
  "get_memory_snapshot",
  "ask_memory",
  "chat",
  "update_memory",
  "supersede_memory",
  "purge_memory",
  "doctor_memory",
  "compact_memory",
  "backup_memory",
  "export_memory",
]) {
  if (!toolNames.includes(required)) {
    throw new Error(`Missing expected tool: ${required}`);
  }
}

const saved = await request("tools/call", {
  name: "remember",
  arguments: {
    text: "Pathmark smoke test memory for MCP users.",
    tags: ["smoke", "mcp"],
    source: "smoke",
  },
});
const savedRecord = JSON.parse(saved.content?.[0]?.text ?? "{}");

await request("tools/call", {
  name: "remember",
  arguments: {
    text: "Pathmark unrelated memory that tag-scoped recall should hide.",
    tags: ["other"],
    source: "smoke",
  },
});

const search = await request("tools/call", {
  name: "search_memory",
  arguments: {
    query: "MCP smoke",
    limit: 3,
  },
});

const text = search.content?.[0]?.text ?? "";
if (!text.includes("Pathmark smoke test memory")) {
  throw new Error("Search did not return saved memory");
}

const chat = await request("tools/call", {
  name: "chat",
  arguments: {
    question: "What did the MCP smoke test save?",
    limit: 3,
  },
});

const chatText = chat.content?.[0]?.text ?? "";
if (!chatText.includes("Pathmark smoke test memory")) {
  throw new Error("Chat did not return saved memory context");
}
if (!chatText.includes("usedMemories")) {
  throw new Error("Chat did not return transparent used memory metadata");
}

const recall = await request("tools/call", {
  name: "recall_memory",
  arguments: {
    query: "MCP smoke",
    limit: 3,
    tags: ["smoke"],
  },
});

const recallText = recall.content?.[0]?.text ?? "";
if (!recallText.includes("Pathmark smoke test memory") || !recallText.includes("usedMemories")) {
  throw new Error("Recall memory did not return transparent memory context");
}
if (recallText.includes("tag-scoped recall should hide")) {
  throw new Error("Recall memory ignored tag scoping");
}

await request("tools/call", {
  name: "remember",
  arguments: {
    text: "MCP smoke current prompt that would otherwise dominate visible recall.",
    tags: ["smoke", "mcp"],
    source: "smoke-current",
  },
});
const exactRecall = await request("tools/call", {
  name: "recall_memory",
  arguments: {
    query: "MCP smoke current prompt",
    ids: [savedRecord.id],
    tags: ["smoke"],
    includeRecords: false,
  },
});
const exactRecallPayload = JSON.parse(exactRecall.content?.[0]?.text ?? "{}");
if (exactRecallPayload.usedMemories?.length !== 1 || exactRecallPayload.usedMemories[0]?.id !== savedRecord.id) {
  throw new Error("Exact-ID recall did not preserve the original visible memory set");
}
if ("records" in exactRecallPayload) {
  throw new Error("Compact visible recall duplicated full records");
}
if (exactRecallPayload.context.includes("would otherwise dominate")) {
  throw new Error("Exact-ID recall admitted a newly captured prompt");
}

await request("tools/call", {
  name: "remember",
  arguments: {
    text: "Session trace smoke prompt.",
    tags: ["session:smoke-session", "role-user"],
    source: "codex:session:smoke-session",
  },
});
const traceResult = await request("tools/call", {
  name: "session_trace",
  arguments: { sessionId: "smoke-session" },
});
const tracePayload = JSON.parse(traceResult.content?.[0]?.text ?? "{}");
if (tracePayload.mode !== "session_trace" || tracePayload.entries?.[0]?.text !== "Session trace smoke prompt.") {
  throw new Error("session_trace did not return the captured chronological entry");
}

const secretSave = await request("tools/call", {
  name: "remember",
  arguments: {
    text: "MCP_SECRET_TOKEN=must-not-be-stored",
    namespace: "private-project",
  },
});
const secretText = secretSave.content?.[0]?.text ?? "";
if (secretText.includes("must-not-be-stored") || !secretText.includes("[REDACTED]")) {
  throw new Error("MCP writes did not redact secret-shaped content");
}

await request("tools/call", {
  name: "remember",
  arguments: { text: "Namespace alpha decision", namespace: "alpha" },
});
await request("tools/call", {
  name: "remember",
  arguments: { text: "Namespace beta decision", namespace: "beta" },
});
const scopedContext = await request("tools/call", {
  name: "get_context",
  arguments: { query: "namespace decision", namespace: "alpha" },
});
const scopedText = scopedContext.content?.[0]?.text ?? "";
if (!scopedText.includes("Namespace alpha decision") || scopedText.includes("Namespace beta decision")) {
  throw new Error("get_context did not honor namespace scoping");
}

const proposalCall = await request("tools/call", {
  name: "create_conclusion",
  arguments: { text: "Approved smoke preference uses concise reports.", tags: ["user-profile"], source: "smoke" },
});
const proposalPayload = JSON.parse(proposalCall.content?.[0]?.text ?? "{}");
if (proposalPayload.status !== "pending_approval" || !proposalPayload.proposal?.id) {
  throw new Error("create_conclusion did not stage a pending proposal");
}
const hiddenProposal = await request("tools/call", {
  name: "search_memory",
  arguments: { query: "concise reports" },
});
if ((hiddenProposal.content?.[0]?.text ?? "").includes("Approved smoke preference")) {
  throw new Error("Pending conclusion leaked into normal search");
}
const pendingList = await request("tools/call", { name: "list_pending_conclusions", arguments: { limit: 10 } });
if (!(pendingList.content?.[0]?.text ?? "").includes(proposalPayload.proposal.id)) {
  throw new Error("Pending conclusion was not available for review");
}
await request("tools/call", {
  name: "approve_conclusion",
  arguments: { id: proposalPayload.proposal.id, decidedBy: "smoke-test" },
});
const snapshot = await request("tools/call", { name: "get_memory_snapshot", arguments: { charLimit: 1200 } });
const snapshotText = snapshot.content?.[0]?.text ?? "";
if (!snapshotText.includes("Approved smoke preference") || !snapshotText.includes("[USER]")) {
  throw new Error("Approved conclusion did not enter the generated snapshot");
}

const rejectedCall = await request("tools/call", {
  name: "create_conclusion",
  arguments: { text: "Rejected smoke conclusion must never be recalled.", source: "smoke" },
});
const rejectedPayload = JSON.parse(rejectedCall.content?.[0]?.text ?? "{}");
await request("tools/call", {
  name: "reject_conclusion",
  arguments: { id: rejectedPayload.proposal.id, decidedBy: "smoke-test" },
});
const rejectedSearch = await request("tools/call", {
  name: "search_memory",
  arguments: { query: "Rejected smoke conclusion" },
});
if ((rejectedSearch.content?.[0]?.text ?? "").includes("must never be recalled")) {
  throw new Error("Rejected conclusion leaked into normal search");
}

const updated = await request("tools/call", {
  name: "update_memory",
  arguments: { id: savedRecord.id, text: "Pathmark updated smoke test memory." },
});
if (!(updated.content?.[0]?.text ?? "").includes("Pathmark updated smoke test memory")) {
  throw new Error("update_memory did not update the record");
}

const doctor = await request("tools/call", { name: "doctor_memory", arguments: {} });
if (!(doctor.content?.[0]?.text ?? "").includes("exactDuplicateRecords")) {
  throw new Error("doctor_memory did not return lifecycle diagnostics");
}

const purgePreview = await request("tools/call", {
  name: "purge_memory",
  arguments: { namespace: "beta" },
});
if (!(purgePreview.content?.[0]?.text ?? "").includes('"applied": false')) {
  throw new Error("purge_memory must preview by default");
}

child.kill("SIGTERM");
console.log(`Smoke test passed with store ${storeDir}`);
