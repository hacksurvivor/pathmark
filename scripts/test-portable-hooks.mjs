import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../dist/config.js";
import { PathmarkStore } from "../dist/store.js";

const storeDir = await mkdtemp(path.join(os.tmpdir(), "pathmark-portable-hooks-"));
const cwd = path.join(storeDir, "project");
const env = { ...process.env, PATHMARK_STORE_DIR: storeDir };

try {
  const before = runHook("before-agent", {
    session_id: "portable-session",
    cwd,
    hook_event_name: "BeforeAgent",
    prompt: "Remember the portable hook decision.",
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(before.status, 0, before.stderr);
  assert.equal(JSON.parse(before.stdout).suppressOutput, true);

  const after = runHook("after-agent", {
    session_id: "portable-session",
    cwd,
    hook_event_name: "AfterAgent",
    prompt_response: "The portable hook decision is saved.",
    timestamp: "2026-01-01T00:01:00.000Z",
  });
  assert.equal(after.status, 0, after.stderr);
  assert.deepEqual(JSON.parse(after.stdout), {});

  process.env.PATHMARK_STORE_DIR = storeDir;
  const store = new PathmarkStore(loadConfig());
  const records = await store.all();
  assert.equal(records.some((record) => record.tags.includes("role-user")), true);
  assert.equal(records.some((record) => record.tags.includes("role-assistant")), true);

  await store.add({
    id: "portable-recall",
    kind: "conclusion",
    text: "Portable hooks use scoped automatic recall.",
    tags: records[0].tags.filter((tag) => tag.startsWith("workspace:")),
    source: "portable-test",
  });
  const start = runHook("session-start", {
    session_id: "new-portable-session",
    cwd,
    hook_event_name: "SessionStart",
  });
  assert.equal(start.status, 0, start.stderr);
  assert.equal(JSON.parse(start.stdout).hookSpecificOutput.additionalContext.includes("Portable hooks use scoped automatic recall"), true);

  console.log("Portable hook tests passed");
} finally {
  await rm(storeDir, { recursive: true, force: true });
}

function runHook(event, input) {
  return spawnSync(process.execPath, ["dist/index.js", "hook", event], {
    cwd: process.cwd(),
    env,
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}
