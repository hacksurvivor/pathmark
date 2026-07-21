import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { observe, prompt, recall, writeback } from "../dist/codex/capture.js";
import { captureToolActivity } from "../dist/codex/activity.js";
import { hasPathmarkMcp, installPathmarkMcp, pathmarkMcpStatus, removePathmarkMcp } from "../dist/codex/config-file.js";
import { cursorPath, readCursor, writeCursor } from "../dist/codex/cursor.js";
import { hookStatus, installPathmarkHooks, uninstallPathmarkHooks } from "../dist/codex/hooks.js";
import { codexConfigPath, codexCursorDir, codexHome, codexHooksPath, pathmarkStoreDir } from "../dist/codex/paths.js";
import { summarizeToolUse } from "../dist/codex/tool-summary.js";
import { readCodexToolResults, readCodexTranscript } from "../dist/codex/transcript.js";
import { loadConfig } from "../dist/config.js";
import { deterministicId } from "../dist/ids.js";
import { redactSecrets } from "../dist/redact.js";
import { PathmarkStore } from "../dist/store.js";
import { sessionTrace } from "../dist/session-trace.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "pathmark-codex-adapter-"));

try {
  assert.equal(deterministicId(["session", "user", "hello"]), deterministicId(["session", "user", "hello"]));

  const fakeOpenAiKey = ["sk", "fixture", "123456789"].join("-");
  const fakeBearerValue = "abcdefghijklmnop";
  const redacted = redactSecrets(`OPENAI_API_KEY=${fakeOpenAiKey} ${["Bearer", fakeBearerValue].join(" ")}`);
  assert.equal(redacted.redacted, true);
  assert.equal(redacted.text.includes(fakeOpenAiKey), false);
  assert.equal(redacted.text.includes(fakeBearerValue), false);

  const standaloneOpenAiKey = ["sk", "proj", "abcdefghijklmnopqrstuvwxyz1234567890"].join("-");
  const standaloneRedacted = redactSecrets(`Use ${standaloneOpenAiKey} carefully`);
  assert.equal(standaloneRedacted.redacted, true);
  assert.equal(standaloneRedacted.text.includes(standaloneOpenAiKey), false);
  assert.equal(standaloneRedacted.text.includes("[REDACTED]"), true);

  const privateKeyMarker = ["PRIVATE", "KEY"].join(" ");
  const privateKeyEnv = ["PRIVATE", "KEY"].join("_");
  const privateKeyPayload = ["fixture", "payload"].join("-");
  const privateKey = redactSecrets(`${privateKeyEnv}="-----BEGIN ${privateKeyMarker}-----\n${privateKeyPayload}\n-----END ${privateKeyMarker}-----"`);
  assert.equal(privateKey.redacted, true);
  assert.equal(privateKey.text.includes(`BEGIN ${privateKeyMarker}`), false);
  assert.equal(privateKey.text.includes(privateKeyPayload), false);

  const databaseUrlSecret = "postgres://user:pass@example/db";
  const databaseUrlRedacted = redactSecrets(`DATABASE_URL=${databaseUrlSecret}`);
  assert.equal(databaseUrlRedacted.redacted, true);
  assert.equal(databaseUrlRedacted.text.includes(databaseUrlSecret), false);
  assert.equal(databaseUrlRedacted.text.includes("user:pass"), false);

  const sentryDsnSecret = "https://key@example.ingest.sentry.io/123";
  const sentryDsnRedacted = redactSecrets(`SENTRY_DSN=${sentryDsnSecret}`);
  assert.equal(sentryDsnRedacted.redacted, true);
  assert.equal(sentryDsnRedacted.text.includes(sentryDsnSecret), false);
  assert.equal(sentryDsnRedacted.text.includes("key@example"), false);

  const harmlessUrl = redactSecrets("PUBLIC_URL=https://example.com/app");
  assert.equal(harmlessUrl.redacted, false);
  assert.equal(harmlessUrl.text, "PUBLIC_URL=https://example.com/app");

  const store = createStore("base");
  const id = deterministicId(["capture", "same"]);
  const first = await store.addRecord({
    id,
    kind: "memory",
    text: "Captured prompt about Pathmark auto capture.",
    tags: ["codex-raw", "role-user"],
    source: "codex:session:test",
    createdAt: "2026-06-29T00:00:00.000Z",
  });
  const second = await store.addRecord({
    id,
    kind: "memory",
    text: "Captured prompt about Pathmark auto capture.",
    tags: ["codex-raw", "role-user"],
    source: "codex:session:test",
    createdAt: "2026-06-29T00:00:00.000Z",
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(await store.count(), 1);
  assert.equal((await jsonlLines("base")).length, 1);

  const activityCompactStore = createStore("activity-compact");
  for (const event of ["first", "second"]) {
    await activityCompactStore.addRecord({
      kind: "memory",
      text: "ran: npm test",
      tags: ["pathmark-activity", "activity-tool", "role-tool", "session:compact-session", `event:${event}`],
      source: "codex:session:compact-session",
      activity: {
        type: "tool",
        toolName: "functions.exec_command",
        callId: "reused-call-id",
        status: "success",
        filesChanged: "unknown",
      },
    });
  }
  const activityCompactResult = await activityCompactStore.compact({ dryRun: false });
  assert.equal(activityCompactResult.removedRecords, 0);
  assert.equal((await activityCompactStore.recordsWithTags(["session:compact-session"])).length, 2);

  const boundedActivityStore = createStore("activity-retention");
  for (const [index, createdAt] of [
    "2026-07-21T00:00:00.000Z",
    "2026-07-21T00:01:00.000Z",
    "2026-07-21T00:02:00.000Z",
  ].entries()) {
    await boundedActivityStore.addRecord({
      id: `activity-retention-${index}`,
      kind: "memory",
      text: `activity ${index}`,
      tags: ["pathmark-activity", "activity-tool", "role-tool", "session:retention-session"],
      source: "codex:session:retention-session",
      createdAt,
      activity: {
        type: "tool",
        toolName: "functions.exec_command",
        callId: `retention-${index}`,
        status: "success",
        filesChanged: "unknown",
      },
    });
  }
  const boundedActivityFile = loadConfig().memoryFile;
  await writeFile(boundedActivityFile, `${await readFile(boundedActivityFile, "utf8")}{invalid-retention-fixture\n`, "utf8");
  const boundedActivityResult = await boundedActivityStore.enforceActivityRetention({ retentionDays: 0, maxRecords: 2 });
  assert.deepEqual(boundedActivityResult, { applied: true, removedRecords: 1 });
  assert.deepEqual(
    (await boundedActivityStore.recordsWithTags(["session:retention-session"])).map((record) => record.id).sort(),
    ["activity-retention-1", "activity-retention-2"],
  );
  assert.equal((await readFile(boundedActivityFile, "utf8")).includes("{invalid-retention-fixture"), true);
  assert.equal((await boundedActivityStore.health()).invalidRecordCount, 1);

  const concurrentStore = createStore("concurrent");
  const concurrentId = deterministicId(["capture", "concurrent"]);
  const concurrentWrites = await Promise.all(
    Array.from({ length: 20 }, (_value, index) =>
      concurrentStore.addRecord({
        id: concurrentId,
        kind: "memory",
        text: `Concurrent prompt capture ${index}`,
        tags: ["codex-raw", "role-user"],
        source: "codex:session:concurrent",
        createdAt: "2026-06-29T00:00:00.000Z",
      }),
    ),
  );
  assert.equal(concurrentWrites.filter((result) => result.created).length, 1);
  assert.equal(await concurrentStore.count(), 1);
  assert.equal((await jsonlLines("concurrent")).length, 1);

  const staleLockStore = createStore("stale-lock");
  const staleLockDir = path.join(loadConfig().storeDir, ".memory.lock");
  await mkdir(staleLockDir, { recursive: true });
  const staleLockTime = new Date(Date.now() - 11 * 60 * 1000);
  await utimes(staleLockDir, staleLockTime, staleLockTime);
  const staleLockWrite = await staleLockStore.addRecord({
    id: deterministicId(["capture", "stale-lock"]),
    kind: "memory",
    text: "Recovered write after abandoned lock.",
    tags: ["codex-raw", "role-user"],
    source: "codex:session:stale-lock",
    createdAt: "2026-06-29T00:00:00.000Z",
  });
  assert.equal(staleLockWrite.created, true);
  assert.equal(await staleLockStore.count(), 1);
  assert.equal((await jsonlLines("stale-lock")).length, 1);

  const previousNoOwnerStaleLockMs = process.env.PATHMARK_NO_OWNER_STALE_LOCK_MS;
  const previousStoreLockTimeoutMs = process.env.PATHMARK_LOCK_TIMEOUT_MS;
  try {
    process.env.PATHMARK_NO_OWNER_STALE_LOCK_MS = "10";
    process.env.PATHMARK_LOCK_TIMEOUT_MS = "100";
    const noOwnerGraceStore = createStore("no-owner-grace-lock");
    await mkdir(path.join(loadConfig().storeDir, ".memory.lock"), { recursive: true });
    const noOwnerGraceWrite = await noOwnerGraceStore.addRecord({
      id: deterministicId(["capture", "no-owner-grace-lock"]),
      kind: "memory",
      text: "Recovered write after no-owner lock grace period.",
      tags: ["codex-raw", "role-user"],
      source: "codex:session:no-owner-grace-lock",
      createdAt: "2026-06-29T00:00:00.000Z",
    });
    assert.equal(noOwnerGraceWrite.created, true);
    assert.equal(await noOwnerGraceStore.count(), 1);
  } finally {
    restoreEnv("PATHMARK_NO_OWNER_STALE_LOCK_MS", previousNoOwnerStaleLockMs);
    restoreEnv("PATHMARK_LOCK_TIMEOUT_MS", previousStoreLockTimeoutMs);
  }

  const deadOwnerStore = createStore("dead-owner-lock");
  const deadOwnerLockDir = path.join(loadConfig().storeDir, ".memory.lock");
  await mkdir(deadOwnerLockDir, { recursive: true });
  await writeFile(
    path.join(deadOwnerLockDir, "owner.json"),
    `${JSON.stringify({ pid: 999999, token: "dead-owner", createdAtMs: Date.now() })}\n`,
    "utf8",
  );
  const deadOwnerWrite = await deadOwnerStore.addRecord({
    id: deterministicId(["capture", "dead-owner-lock"]),
    kind: "memory",
    text: "Recovered write after dead owner lock.",
    tags: ["codex-raw", "role-user"],
    source: "codex:session:dead-owner-lock",
    createdAt: "2026-06-29T00:00:00.000Z",
  });
  assert.equal(deadOwnerWrite.created, true);
  assert.equal(await deadOwnerStore.count(), 1);

  const rankingStore = createStore("ranking");
  const conclusionId = deterministicId(["ranking", "conclusion"]);
  const toolId = deterministicId(["ranking", "tool"]);
  const summaryId = deterministicId(["ranking", "summary"]);
  const legacySummaryId = deterministicId(["ranking", "legacy-summary"]);
  await rankingStore.addRecord({
    id: conclusionId,
    kind: "conclusion",
    text: "Stable architecture preference.",
    tags: ["decision"],
    source: "test",
    createdAt: "2026-06-29T00:00:00.000Z",
  });
  await rankingStore.addRecord({
    id: toolId,
    kind: "memory",
    text: "needle",
    tags: ["role-tool"],
    source: "test",
    createdAt: "2026-06-29T00:00:01.000Z",
  });
  await rankingStore.addRecord({
    id: summaryId,
    kind: "memory",
    text: "shared capture",
    tags: ["codex-summary"],
    source: "test",
    createdAt: "2026-06-29T00:00:02.000Z",
  });
  await rankingStore.addRecord({
    id: legacySummaryId,
    kind: "memory",
    text: "shared capture",
    tags: ["codex-summary", "legacy-import"],
    source: "test",
    createdAt: "2026-06-29T00:00:03.000Z",
  });

  const unrelatedResults = await rankingStore.search({ query: "unrelated", limit: 10 });
  assert.equal(unrelatedResults.some((result) => result.record.id === conclusionId), false);

  const toolResults = await rankingStore.search({ query: "needle", limit: 10 });
  assert.equal(toolResults.some((result) => result.record.id === toolId), true);

  const summaryResults = await rankingStore.search({ query: "shared", limit: 10 });
  const summaryScore = summaryResults.find((result) => result.record.id === summaryId)?.score;
  const legacySummaryScore = summaryResults.find((result) => result.record.id === legacySummaryId)?.score;
  assert.equal(typeof summaryScore, "number");
  assert.equal(typeof legacySummaryScore, "number");
  assert.equal(summaryScore - legacySummaryScore, 1);

  const compatStore = createStore("compat");
  const compatRecord = await compatStore.add({
    kind: "memory",
    text: " Add compatibility memory ",
    tags: [" TEST ", "test"],
    source: " ",
  });
  assert.equal(compatRecord.text, "Add compatibility memory");
  assert.deepEqual(compatRecord.tags, ["test"]);
  assert.equal(compatRecord.source, "mcp");
  assert.equal(await compatStore.count(), 1);
  const deletedRecord = await compatStore.delete(compatRecord.id);
  assert.ok(deletedRecord?.deletedAt);
  assert.equal(await compatStore.count(), 1);
  assert.equal((await compatStore.all()).length, 0);
  assert.equal((await compatStore.all({ includeDeleted: true })).length, 1);

  const transcript = path.join(temp, "transcript.jsonl");
  await writeFile(
    transcript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<pathmark-memory>skip</pathmark-memory>" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Please remember this Pathmark decision." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:03.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "I’m checking the Pathmark decision now." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:04.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "Decision captured." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );

  const turns = await readCodexTranscript(transcript);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].role, "user");
  assert.equal(turns[1].role, "assistant");
  assert.equal(turns[1].text, "Decision captured.");

  const transportTranscript = path.join(temp, "transport-transcript.jsonl");
  const unwrappedRequest = "Fix exact recall without duplicating Codex transport metadata.";
  await writeFile(
    transportTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:00:04.100Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<recommended_plugins>injected catalog</recommended_plugins>" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:04.200Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<codex_internal_context source=\"goal\">continue</codex_internal_context>" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:04.300Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "# Files mentioned by the user:\n\n## attachment.txt" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:04.400Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `# Response annotations:\n<response-annotations>transport</response-annotations>\n\n## My request for Codex:\n${unwrappedRequest}`,
            },
          ],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  const transportTurns = await readCodexTranscript(transportTranscript);
  assert.deepEqual(
    transportTurns.map((turn) => ({ role: turn.role, text: turn.text })),
    [{ role: "user", text: unwrappedRequest }],
  );

  const toolResultTranscript = path.join(temp, "tool-result-transcript.jsonl");
  await writeFile(
    toolResultTranscript,
    `${JSON.stringify({
      timestamp: "2026-06-29T00:00:04.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "exec-reconcile",
        output: [
          { type: "input_text", text: "Script completed\nWall time 1.6 seconds\nOutput:\n" },
          { type: "input_text", text: "reconciled output" },
        ],
      },
    })}\n`,
    "utf8",
  );
  const parsedToolResults = await readCodexToolResults(toolResultTranscript);
  assert.deepEqual(
    parsedToolResults.map(({ callId, status, exitCode, durationMs }) => ({ callId, status, exitCode, durationMs })),
    [{ callId: "exec-reconcile", status: "success", exitCode: 0, durationMs: 1600 }],
  );

  const cursorStoreDir = path.join(temp, "cursor");
  assert.equal(await readCursor(cursorStoreDir, "session-a"), 0);
  await writeCursor(cursorStoreDir, "session-a", 2);
  assert.equal(await readCursor(cursorStoreDir, "session-a"), 2);

  assert.equal(summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "pwd" } }), "");
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "npm test" } }),
    "ran: npm test",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg -l old src" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg foo src 2>/dev/null" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg foo src 2> /dev/null" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg foo src > /dev/null" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "grep foo file >/dev/null" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "jq . package.json >/dev/null" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "git branch --show-current" } }),
    "",
  );
  assert.equal(summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "git remote -v" } }), "");
  assert.equal(summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "du -sh ." } }), "");
  assert.equal(summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg TODO src || true" } }), "");
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat package.json && true" } }),
    "",
  );
  assert.equal(summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "git status || true" } }), "");
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg -l old src | xargs sed -i 's/old/new/g'" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg TODO src | tee todo.txt" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "grep foo file | tee out.txt" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "jq . package.json > out.json" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat script.sh | bash" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: 'rg TODO src | while read f; do rm "$f"; done' },
    }).startsWith("ran:"),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "git diff | git apply" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "jq . package.json | sponge package.json" },
    }).startsWith("ran:"),
    true,
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "git status && git add src && git commit -m x" },
    }).startsWith("ran:"),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "git status && npm test" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "cat package.json && npm test" },
    }).startsWith("ran:"),
    true,
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "cat package.json && npm run build" },
    }).startsWith("ran:"),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg TODO src && npm test" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg TODO src || npm test" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg foo src || npm test" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg old src && rm target.txt" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat file; mv file file.bak" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat input | tee output" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "sed -i.bak 's/a/b/' file" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "sed -i'' 's/a/b/' file" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat input > output" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat input>output" } }).startsWith("ran:"),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat input>>output" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat input> output" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat <<EOF > file\nvalue\nEOF" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "pathmark codex status" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "PATHMARK_STORE_DIR=/tmp pathmark codex status" },
    }),
    "",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "npm test && pathmark codex status" } }),
    "ran: npm test",
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "rm -rf tmp-cache && pathmark codex status" },
    }),
    "ran: rm -rf tmp-cache",
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "PATHMARK_STORE_DIR=/tmp node ./dist/index.js codex prompt" },
    }),
    "",
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "node --inspect ./dist/index.js codex prompt" },
    }),
    "",
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: `node ${"--trace-warnings ".repeat(2_000)}./safe-script.js` },
    }).startsWith("ran:"),
    true,
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "node /workspace/pathmark/dist/index.js codex observe" },
    }),
    "",
  );
  assert.equal(summarizeToolUse({ tool_name: "mcp__pathmark__search_memory", tool_input: {} }), "");
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.apply_patch",
      tool_input: "*** Begin Patch\n*** Update File: src/example.ts\n@@\n-old\n+new\n*** End Patch\n",
    }),
    "edited: src/example.ts",
  );

  const structuredTool = captureToolActivity({
    tool_name: "functions.exec_command",
    tool_input: { cmd: `npm test -- TOKEN=${fakeBearerValue}` },
    tool_response: { output: `tests passed TOKEN=${fakeBearerValue}`, exit_code: 0, wall_time_seconds: 1.25 },
    tool_use_id: "call-structured",
  }, { includeOutputPreview: true });
  assert.ok(structuredTool);
  assert.equal(structuredTool.activity.status, "success");
  assert.equal(structuredTool.activity.exitCode, 0);
  assert.equal(structuredTool.activity.durationMs, 1250);
  assert.equal(structuredTool.activity.callId, "call-structured");
  assert.equal(structuredTool.activity.commandPreview.includes(fakeBearerValue), false);
  assert.equal(structuredTool.activity.outputPreview.includes(fakeBearerValue), false);
  assert.equal(structuredTool.activity.commandPreview.length <= 2_000, true);
  assert.equal(structuredTool.activity.outputPreview.length <= 2_000, true);

  const failedTool = captureToolActivity({
    tool_name: "custom.deploy",
    tool_input: { target: "staging" },
    tool_result: { error: "deployment failed" },
    call_id: "call-failed",
  }, { includeOutputPreview: true });
  assert.ok(failedTool);
  assert.equal(failedTool.activity.status, "error");
  assert.equal(failedTool.activity.callId, "call-failed");
  assert.equal(failedTool.activity.inputPreview, '{"target":"staging"}');
  assert.equal(failedTool.activity.outputPreview, "deployment failed");

  const patchActivity = captureToolActivity({
    tool_name: "functions.apply_patch",
    tool_input: "*** Begin Patch\n*** Update File: src/example.ts\n@@\n-old\n+new\n*** End Patch\n",
  });
  assert.ok(patchActivity);
  assert.equal(patchActivity.activity.status, "unknown");
  assert.equal(patchActivity.activity.filesChanged, true);
  assert.deepEqual(patchActivity.activity.changedFiles, ["src/example.ts"]);

  const boundedOutputTool = captureToolActivity({
    tool_name: "custom.report",
    tool_input: { format: "text" },
    tool_response: { content: [{ text: "x".repeat(3_000) }] },
  }, { includeOutputPreview: true });
  assert.ok(boundedOutputTool);
  assert.equal(boundedOutputTool.activity.status, "success");
  assert.equal(boundedOutputTool.activity.outputPreview.length, 2_000);
  assert.equal(boundedOutputTool.activity.filesChanged, "unknown");

  const splitOutputTool = captureToolActivity({
    tool_name: "custom.compiler",
    tool_input: { target: "release" },
    tool_response: { stdout: "compiled", stderr: "one warning" },
  }, { includeOutputPreview: true });
  assert.equal(splitOutputTool.activity.outputPreview, "compiled\none warning");

  const codexEnvelopeTool = captureToolActivity({
    tool_name: "functions.exec_command",
    tool_input: { cmd: "npm test" },
    tool_response: "Script completed\nWall time 1.75 seconds\nOutput:\npassed",
  });
  assert.equal(codexEnvelopeTool.activity.exitCode, 0);
  assert.equal(codexEnvelopeTool.activity.durationMs, 1750);

  const failedEnvelopeTool = captureToolActivity({
    tool_name: "functions.exec_command",
    tool_input: { cmd: "npm test" },
    tool_response: "Process exited with code 2\nWall time: 450 ms\nOutput:\nfailed",
  });
  assert.equal(failedEnvelopeTool.activity.exitCode, 2);
  assert.equal(failedEnvelopeTool.activity.durationMs, 450);
  assert.equal(failedEnvelopeTool.activity.status, "error");

  const privateOutputTool = captureToolActivity({
    tool_name: "custom.compiler",
    tool_input: { target: "release" },
    tool_response: { output: "private build output" },
  });
  assert.equal("outputPreview" in privateOutputTool.activity, false);
  assert.equal(typeof privateOutputTool.activity.outputHash, "string");

  createStore("tool-result-reconciliation");
  await observe({
    session_id: "reconcile-session",
    tool_name: "functions.exec_command",
    tool_input: { cmd: "npm test" },
    tool_response: { output: "reconciled output" },
    tool_use_id: "exec-reconcile",
  });
  await writeback({ session_id: "reconcile-session", transcript_path: toolResultTranscript });
  const reconciledTrace = await sessionTrace(new PathmarkStore(loadConfig()), "reconcile-session");
  const reconciledTool = reconciledTrace.entries.find((entry) => entry.callId === "exec-reconcile");
  assert.equal(reconciledTool.exitCode, 0);
  assert.equal(reconciledTool.durationMs, 1600);

  createStore("capture");
  const nudge = await prompt({
    session_id: "capture-session",
    prompt: "Remember that Pathmark uses hybrid capture.",
  });
  assert.equal(nudge.includes("<pathmark-memory-nudge>"), true);
  assert.equal(await prompt({ session_id: "capture-session", prompt: "ok." }), "");
  assert.equal(
    await prompt({
      session_id: "capture-session",
      prompt: "<recommended_plugins>injected prompt catalog</recommended_plugins>",
    }),
    "",
  );
  const normalizedPrompt = "Normalize this Codex transport request.";
  await prompt({
    session_id: "capture-session",
    prompt: `# Files mentioned by the user:\n\n## fixture.txt\n\n## My request for Codex:\n${normalizedPrompt}`,
  });
  const normalizedPromptRecords = await new PathmarkStore(loadConfig()).recordsWithTags(
    ["session:capture-session", "role-user"],
    { limit: 100 },
  );
  assert.equal(normalizedPromptRecords.some((record) => record.text === normalizedPrompt), true);
  assert.equal(normalizedPromptRecords.some((record) => record.text.startsWith("# Files mentioned")), false);
  assert.equal(normalizedPromptRecords.some((record) => record.text.includes("injected prompt catalog")), false);

  const proactiveStore = createStore("proactive-prompt");
  await prompt({
    cwd: "/workspace/pathmark",
    session_id: "proactive-source",
    prompt: "Remember launch checklist requires trusted publisher.",
  });
  const proactiveContext = await prompt({
    cwd: "/workspace/pathmark",
    session_id: "proactive-target",
    prompt: "Continue the launch checklist now.",
  });
  assert.equal(proactiveContext.includes("<pathmark-memory>"), true);
  assert.equal(proactiveContext.includes("Used memories:"), true);
  assert.equal(proactiveContext.includes("launch checklist requires trusted publisher"), true);
  assert.equal(proactiveContext.includes("Continue the launch checklist now"), false);
  assert.equal(proactiveContext.includes("Visible recall request:"), true);
  assert.equal(proactiveContext.includes("mcp__pathmark__recall_memory"), true);
  assert.equal(proactiveContext.includes('"tags":["workspace:'), true);
  const visibleArgsMatch = proactiveContext.match(/recall_memory with (\{.*\}) so the UI/);
  assert.notEqual(visibleArgsMatch, null);
  const visibleArgs = JSON.parse(visibleArgsMatch[1]);
  assert.equal(Array.isArray(visibleArgs.ids), true);
  assert.equal(visibleArgs.ids.length, 1);
  assert.equal(visibleArgs.includeRecords, false);
  const targetPromptRecord = (await proactiveStore.search({ query: "Continue the launch checklist now", limit: 5 })).find(
    (result) => result.record.text === "Continue the launch checklist now.",
  );
  assert.notEqual(targetPromptRecord, undefined);
  assert.equal(visibleArgs.ids.includes(targetPromptRecord.record.id), false);
  const exactVisibleResults = await proactiveStore.searchByIds({
    ids: visibleArgs.ids,
    query: visibleArgs.query,
    tags: visibleArgs.tags,
  });
  assert.deepEqual(
    exactVisibleResults.map((result) => result.record.id),
    visibleArgs.ids,
  );
  assert.equal(exactVisibleResults[0].record.text, "Remember launch checklist requires trusted publisher.");
  const proactiveTrace = await sessionTrace(proactiveStore, "proactive-target");
  const proactiveRecallEntry = proactiveTrace.entries.find((entry) => entry.type === "recall");
  assert.ok(proactiveRecallEntry);
  assert.deepEqual(proactiveRecallEntry.memoryIds, visibleArgs.ids);
  assert.equal(proactiveRecallEntry.memoryCount, visibleArgs.ids.length);
  assert.equal(typeof proactiveRecallEntry.queryHash, "string");

  const crossProjectStore = createStore("cross-project-recall");
  await prompt({
    cwd: "/workspace/meetily",
    session_id: "cross-project-source",
    prompt: "Meetily transcription design uses a local-first capture architecture.",
  });
  const crossProjectContext = await prompt({
    cwd: "/workspace/pathmark",
    session_id: "cross-project-target",
    prompt: "Recall the Meetily transcription design.",
  });
  assert.equal(crossProjectContext.includes("Meetily transcription design uses a local-first capture architecture"), true);
  const crossProjectArgsMatch = crossProjectContext.match(/recall_memory with (\{.*\}) so the UI/);
  assert.ok(crossProjectArgsMatch);
  const crossProjectArgs = JSON.parse(crossProjectArgsMatch[1]);
  assert.equal("tags" in crossProjectArgs, false);
  const crossProjectExact = await crossProjectStore.searchByIds({
    ids: crossProjectArgs.ids,
    query: crossProjectArgs.query,
  });
  assert.deepEqual(crossProjectExact.map((result) => result.record.id), crossProjectArgs.ids);

  createStore("workspace-first-recall");
  await prompt({
    cwd: "/workspace/huncho",
    session_id: "workspace-first-huncho-source",
    prompt: "Restarted Codex after installing Pathmark; Huncho session trace exposes eighteen tools.",
  });
  await prompt({
    cwd: "/workspace/co-ode",
    session_id: "workspace-first-coode-source",
    prompt: "Restarted Codex and installed Pathmark while repairing unrelated mission orchestration.",
  });
  const workspaceFirstContext = await prompt({
    cwd: "/workspace/huncho",
    session_id: "workspace-first-huncho-target",
    prompt: "I restarted Codex after installing Pathmark.",
  });
  assert.equal(workspaceFirstContext.includes("Huncho session trace exposes eighteen tools"), true);
  assert.equal(workspaceFirstContext.includes("unrelated mission orchestration"), false);
  const workspaceFirstArgsMatch = workspaceFirstContext.match(/recall_memory with (\{.*\}) so the UI/);
  assert.ok(workspaceFirstArgsMatch);
  const workspaceFirstArgs = JSON.parse(workspaceFirstArgsMatch[1]);
  assert.equal(Array.isArray(workspaceFirstArgs.tags), true);
  assert.equal(workspaceFirstArgs.tags.length, 1);
  assert.equal(workspaceFirstArgs.ids.length, 1);

  createStore("prompt-relevance");
  await prompt({
    cwd: "/workspace/pathmark",
    session_id: "relevance-source",
    prompt: "SovaMax email needs company ID format for ERP transfer.",
  });
  await prompt({
    cwd: "/workspace/pathmark",
    session_id: "relevance-duplicate",
    prompt: "SovaMax email needs the company ID format for ERP transfer and IT automation.",
  });
  await prompt({
    cwd: "/workspace/pathmark",
    session_id: "relevance-noise",
    prompt: "Meetily is a local transcription project with company templates and email exports.",
  });
  const relevanceContext = await prompt({
    cwd: "/workspace/pathmark",
    session_id: "relevance-target",
    prompt: "Draft the SovaMax email requesting company ID format for ERP transfer.",
  });
  assert.equal(relevanceContext.includes("SovaMax email needs company ID format for ERP transfer"), true);
  assert.equal(relevanceContext.includes("IT automation"), false);
  assert.equal(relevanceContext.includes("Meetily"), false);

  const previousVisibleRecall = process.env.PATHMARK_CODEX_VISIBLE_RECALL;
  try {
    process.env.PATHMARK_CODEX_VISIBLE_RECALL = "off";
    createStore("visible-recall-off");
    await prompt({
      cwd: "/workspace/pathmark",
      session_id: "visible-off-source",
      prompt: "Remember launch checklist requires trusted publisher.",
    });
    const visibleOffContext = await prompt({
      cwd: "/workspace/pathmark",
      session_id: "visible-off-target",
      prompt: "Continue the launch checklist now.",
    });
    assert.equal(visibleOffContext.includes("<pathmark-memory>"), true);
    assert.equal(visibleOffContext.includes("Visible recall request:"), false);
  } finally {
    restoreEnv("PATHMARK_CODEX_VISIBLE_RECALL", previousVisibleRecall);
  }

  const previousProactiveRecall = process.env.PATHMARK_CODEX_PROACTIVE_RECALL;
  try {
    process.env.PATHMARK_CODEX_PROACTIVE_RECALL = "off";
    createStore("proactive-off");
    await prompt({
      cwd: "/workspace/pathmark",
      session_id: "proactive-off-source",
      prompt: "Remember launch checklist requires trusted publisher.",
    });
    const proactiveOffContext = await prompt({
      cwd: "/workspace/pathmark",
      session_id: "proactive-off-target",
      prompt: "Continue the launch checklist now.",
    });
    assert.equal(proactiveOffContext, "");
  } finally {
    restoreEnv("PATHMARK_CODEX_PROACTIVE_RECALL", previousProactiveRecall);
  }

  const previousCaptureToolOutputs = process.env.PATHMARK_CODEX_CAPTURE_TOOL_OUTPUTS;
  process.env.PATHMARK_CODEX_CAPTURE_TOOL_OUTPUTS = "on";
  await observe({
    session_id: "capture-session",
    tool_name: "functions.exec_command",
    tool_input: { cmd: "npm run build" },
    tool_response: { output: "Build completed successfully.", exit_code: 0, wall_time_seconds: 2.4 },
    tool_use_id: "call-build",
  });
  restoreEnv("PATHMARK_CODEX_CAPTURE_TOOL_OUTPUTS", previousCaptureToolOutputs);

  const captureTraceStore = new PathmarkStore(loadConfig());
  const trace = await sessionTrace(captureTraceStore, "capture-session");
  const toolEntry = trace.entries.find((entry) => entry.type === "tool" && entry.callId === "call-build");
  assert.ok(toolEntry);
  assert.equal(toolEntry.status, "success");
  assert.equal(toolEntry.exitCode, 0);
  assert.equal(toolEntry.durationMs, 2400);
  assert.equal(toolEntry.outputPreview, "Build completed successfully.");
  const compactTrace = await sessionTrace(captureTraceStore, "capture-session", { includeOutputs: false });
  const compactToolEntry = compactTrace.entries.find((entry) => entry.type === "tool" && entry.callId === "call-build");
  assert.equal("outputPreview" in compactToolEntry, false);
  assert.equal(typeof compactToolEntry.outputHash, "string");
  const storedBuildActivity = (await captureTraceStore.recordsWithTags(["session:capture-session", "activity-tool"]))
    .find((record) => record.activity?.type === "tool" && record.activity.callId === "call-build");
  assert.ok(storedBuildActivity?.expiresAt);
  assert.equal(Date.parse(storedBuildActivity.expiresAt) > Date.now() + 29 * 24 * 60 * 60 * 1_000, true);

  await observe({
    session_id: "private-output-session",
    tool_name: "functions.exec_command",
    tool_input: { cmd: "npm test" },
    tool_response: { output: "customer-private-output", exit_code: 0 },
    tool_use_id: "call-private-output",
  });
  const privateOutputTrace = await sessionTrace(new PathmarkStore(loadConfig()), "private-output-session");
  const privateOutputEntry = privateOutputTrace.entries.find((entry) => entry.callId === "call-private-output");
  assert.ok(privateOutputEntry);
  assert.equal("outputPreview" in privateOutputEntry, false);
  assert.equal(typeof privateOutputEntry.outputHash, "string");

  const previousLockTimeoutMs = process.env.PATHMARK_LOCK_TIMEOUT_MS;
  const previousStaleLockMs = process.env.PATHMARK_STALE_LOCK_MS;
  try {
    process.env.PATHMARK_LOCK_TIMEOUT_MS = "25";
    process.env.PATHMARK_STALE_LOCK_MS = "600000";
    createStore("fresh-lock-warning");
    await mkdir(path.join(loadConfig().storeDir, ".memory.lock"), { recursive: true });
    const lockWarning = await prompt({
      session_id: "fresh-lock-session",
      prompt: "Remember that fresh locks should warn.",
    });
    assert.equal(lockWarning.includes("<pathmark-memory-warning>"), true);
    assert.equal(lockWarning.includes("Timed out waiting for Pathmark store lock"), true);
  } finally {
    await rm(path.join(temp, "fresh-lock-warning", ".memory.lock"), { recursive: true, force: true });
    restoreEnv("PATHMARK_LOCK_TIMEOUT_MS", previousLockTimeoutMs);
    restoreEnv("PATHMARK_STALE_LOCK_MS", previousStaleLockMs);
  }

  createStore("capture");
  await prompt({
    session_id: "capture-session",
    prompt: `Remember OPENAI_API_KEY=${fakeOpenAiKey} for this test.`,
  });
  await prompt({
    session_id: "token-session",
    prompt: `Use standalone token ${standaloneOpenAiKey} carefully.`,
  });
  await prompt({
    session_id: "database-url-session",
    prompt: `Remember DATABASE_URL=${databaseUrlSecret} for deploy.`,
  });
  await prompt({
    session_id: "dsn-session",
    prompt: `Remember SENTRY_DSN=${sentryDsnSecret} for alerts.`,
  });
  const longPrivateKey = `-----BEGIN ${privateKeyMarker}-----${privateKeyPayload.repeat(40)}-----END ${privateKeyMarker}-----`;
  await observe({
    session_id: "capture-session",
    tool_name: "functions.exec_command",
    tool_input: { cmd: `npm run deploy -- ${privateKeyEnv}="${longPrivateKey}"` },
  });
  await writeback({ session_id: "capture-session", transcript_path: transcript });

  const captureStore = new PathmarkStore(loadConfig());
  const captured = await captureStore.search({ query: "hybrid capture build", limit: 20 });
  assert.equal(captured.some((result) => result.record.tags.includes("role-user")), true);
  assert.equal(captured.some((result) => result.record.tags.includes("role-tool")), true);

  const assistantCapture = await captureStore.search({ query: "Decision captured", limit: 20 });
  assert.equal(assistantCapture.some((result) => result.record.tags.includes("role-assistant")), true);

  const redactedCapture = await captureStore.search({ query: "OPENAI_API_KEY", limit: 20 });
  const redactedRecord = redactedCapture.find((result) => result.record.tags.includes("redacted"))?.record;
  assert.ok(redactedRecord);
  assert.equal(redactedRecord.text.includes(fakeOpenAiKey), false);
  assert.equal(redactedRecord.text.includes("[REDACTED]"), true);

  const standaloneTokenCapture = await captureStore.search({ query: "standalone token", limit: 20 });
  const standaloneTokenRecord = standaloneTokenCapture.find((result) => result.record.source === "codex:session:token-session")
    ?.record;
  assert.ok(standaloneTokenRecord);
  assert.equal(standaloneTokenRecord.tags.includes("redacted"), true);
  assert.equal(standaloneTokenRecord.text.includes(standaloneOpenAiKey), false);
  assert.equal(standaloneTokenRecord.text.includes("[REDACTED]"), true);

  const databaseUrlCapture = await captureStore.search({ query: "DATABASE_URL", limit: 20 });
  const databaseUrlRecord = databaseUrlCapture.find((result) => result.record.source === "codex:session:database-url-session")
    ?.record;
  assert.ok(databaseUrlRecord);
  assert.equal(databaseUrlRecord.tags.includes("redacted"), true);
  assert.equal(databaseUrlRecord.text.includes(databaseUrlSecret), false);
  assert.equal(databaseUrlRecord.text.includes("user:pass"), false);
  assert.equal(databaseUrlRecord.text.includes("[REDACTED]"), true);

  const sentryDsnCapture = await captureStore.search({ query: "SENTRY_DSN", limit: 20 });
  const sentryDsnRecord = sentryDsnCapture.find((result) => result.record.source === "codex:session:dsn-session")?.record;
  assert.ok(sentryDsnRecord);
  assert.equal(sentryDsnRecord.tags.includes("redacted"), true);
  assert.equal(sentryDsnRecord.text.includes(sentryDsnSecret), false);
  assert.equal(sentryDsnRecord.text.includes("key@example"), false);
  assert.equal(sentryDsnRecord.text.includes("[REDACTED]"), true);

  const privateKeyCapture = await captureStore.search({ query: "npm run deploy", limit: 20 });
  const privateKeyRecord = privateKeyCapture.find((result) => result.record.tags.includes("role-tool"))?.record;
  assert.ok(privateKeyRecord);
  assert.equal(privateKeyRecord.tags.includes("redacted"), true);
  assert.equal(privateKeyRecord.text.includes(["BEGIN", privateKeyMarker].join(" ")), false);
  assert.equal(privateKeyRecord.text.includes(privateKeyPayload), false);
  assert.equal(privateKeyRecord.text.includes("[REDACTED]"), true);

  const duplicatePrompt = "Remember that Pathmark uses hybrid capture.";
  const duplicateTranscript = path.join(temp, "duplicate-transcript.jsonl");
  await prompt({ session_id: "dedupe-session", prompt: duplicatePrompt });
  const duplicateAt = new Date().toISOString();
  await writeFile(
    duplicateTranscript,
    [
      JSON.stringify({
        timestamp: duplicateAt,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: duplicatePrompt }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:05.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "ok" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:06.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "do it" }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: "dedupe-session", transcript_path: duplicateTranscript });
  const dedupeRecords = await captureStore.all();
  const duplicateUserRecords = dedupeRecords.filter(
    (record) =>
      record.source === "codex:session:dedupe-session" &&
      record.tags.includes("role-user") &&
      record.text === duplicatePrompt,
  );
  assert.equal(duplicateUserRecords.length, 1);
  assert.equal(
    dedupeRecords.some(
      (record) =>
        record.source === "codex:session:dedupe-session" &&
        record.tags.includes("role-user") &&
        (record.text === "ok" || record.text === "do it"),
    ),
    false,
  );

  const repeatedPrompt = "Please preserve this repeated nontrivial prompt.";
  const repeatedTranscript = path.join(temp, "repeated-transcript.jsonl");
  await writeFile(
    repeatedTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:00:07.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: repeatedPrompt }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:08.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: repeatedPrompt }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: "repeat-session", transcript_path: repeatedTranscript });
  const repeatedUserRecords = (await captureStore.all()).filter(
    (record) =>
      record.source === "codex:session:repeat-session" &&
      record.tags.includes("role-user") &&
      record.text === repeatedPrompt,
  );
  assert.equal(repeatedUserRecords.length, 2);

  const stalePrompt = "Please preserve this stale repeated prompt.";
  const staleTranscript = path.join(temp, "stale-transcript.jsonl");
  await captureStore.addRecord({
    id: deterministicId(["stale", "immediate"]),
    kind: "memory",
    text: stalePrompt,
    tags: ["codex-raw", "codex-session", "role-user", "session:stale-session", "immediate-prompt"],
    source: "codex:session:stale-session",
    createdAt: "2026-06-29T00:00:00.000Z",
  });
  await writeFile(
    staleTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:30:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: stalePrompt }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: "stale-session", transcript_path: staleTranscript });
  const staleUserRecords = (await captureStore.all()).filter(
    (record) =>
      record.source === "codex:session:stale-session" &&
      record.tags.includes("role-user") &&
      record.text === stalePrompt,
  );
  assert.equal(staleUserRecords.length, 2);
  assert.equal(staleUserRecords.some((record) => !record.tags.includes("immediate-prompt")), true);

  const malformedTranscript = path.join(temp, "malformed-transcript.jsonl");
  const malformedStoreDir = loadConfig().storeDir;
  await writeFile(
    malformedTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:40:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "This malformed writeback must not advance cursor." }],
        },
      }),
      "{not-json",
    ].join("\n") + "\n",
    "utf8",
  );
  const malformedWarning = await writeback({ session_id: "malformed-session", transcript_path: malformedTranscript });
  assert.equal(malformedWarning.includes("<pathmark-memory-warning>"), true);
  assert.equal(malformedWarning.includes("Pathmark could not write transcript memory"), true);
  assert.equal(await readCursor(malformedStoreDir, "malformed-session"), 0);
  assert.equal(
    (await captureStore.all()).some((record) => record.source === "codex:session:malformed-session"),
    false,
  );

  const malformedMessageTranscript = path.join(temp, "malformed-message-transcript.jsonl");
  await writeFile(
    malformedMessageTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:45:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "unsupported", text: "This strict malformed message must not be captured." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  const malformedMessageWarning = await writeback({
    session_id: "malformed-message-session",
    transcript_path: malformedMessageTranscript,
  });
  assert.equal(malformedMessageWarning.includes("<pathmark-memory-warning>"), true);
  assert.equal(malformedMessageWarning.includes("Pathmark could not write transcript memory"), true);
  assert.equal(await readCursor(malformedStoreDir, "malformed-message-session"), 0);
  assert.equal(
    (await captureStore.all()).some((record) => record.source === "codex:session:malformed-message-session"),
    false,
  );

  const legacyCursorStore = createStore("legacy-cursor-replacement");
  const legacyCursorStoreDir = loadConfig().storeDir;
  const legacyCursorSession = "legacy-count-session";
  const legacyCursorFile = cursorPath(legacyCursorStoreDir, legacyCursorSession);
  await mkdir(path.dirname(legacyCursorFile), { recursive: true });
  await writeFile(legacyCursorFile, JSON.stringify({ count: 2 }, null, 2), "utf8");
  const legacyCursorTranscript = path.join(temp, "legacy-cursor-transcript.jsonl");
  await writeFile(
    legacyCursorTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:45:10.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Legacy cursor fresh turn one." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:45:11.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Legacy cursor fresh turn two." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: legacyCursorSession, transcript_path: legacyCursorTranscript });
  const legacyCursorRecords = await legacyCursorStore.all();
  assert.equal(legacyCursorRecords.some((record) => record.text === "Legacy cursor fresh turn one."), true);
  assert.equal(legacyCursorRecords.some((record) => record.text === "Legacy cursor fresh turn two."), true);
  assert.equal(await readCursor(legacyCursorStoreDir, legacyCursorSession), 2);
  const legacyCursorState = JSON.parse(await readFile(legacyCursorFile, "utf8"));
  assert.equal(typeof legacyCursorState.transcriptFingerprint, "string");
  assert.equal(legacyCursorState.transcriptFingerprint.length > 0, true);

  const parserMigrationStore = createStore("parser-version-migration");
  const parserMigrationStoreDir = loadConfig().storeDir;
  const parserMigrationSession = "parser-version-session";
  const parserMigrationTranscript = path.join(temp, "parser-version-transcript.jsonl");
  const migrationUserText = "Preserve this user turn during parser migration.";
  const migrationFinalText = "Preserve this final answer during parser migration.";
  const migrationInjectedText = "<codex_internal_context source=\"goal\">Do not store this injected goal.</codex_internal_context>";
  const migrationUnwrappedText = "Retain this real request after transport migration.";
  const migrationWrapperText = `# Response annotations:\n<response-annotations>legacy</response-annotations>\n\n## My request for Codex:\n${migrationUnwrappedText}`;
  await parserMigrationStore.addRecords([
    {
      id: "parser-migration-user",
      kind: "memory",
      text: migrationUserText,
      tags: ["codex-raw", "codex-session", "role-user", `session:${parserMigrationSession}`],
      source: `codex:session:${parserMigrationSession}`,
      createdAt: "2026-06-29T00:45:20.000Z",
    },
    {
      id: "parser-migration-final",
      kind: "memory",
      text: migrationFinalText,
      tags: ["codex-raw", "codex-session", "role-assistant", `session:${parserMigrationSession}`],
      source: `codex:session:${parserMigrationSession}`,
      createdAt: "2026-06-29T00:45:22.000Z",
    },
    {
      id: "parser-migration-commentary",
      kind: "memory",
      text: "This progress update must not be captured.",
      tags: ["codex-raw", "codex-session", "role-assistant", `session:${parserMigrationSession}`],
      source: `codex:session:${parserMigrationSession}`,
      createdAt: "2026-06-29T00:45:21.000Z",
    },
    {
      id: "parser-migration-injected-user",
      kind: "memory",
      text: migrationInjectedText,
      tags: ["codex-raw", "codex-session", "role-user", `session:${parserMigrationSession}`],
      source: `codex:session:${parserMigrationSession}`,
      createdAt: "2026-06-29T00:45:18.000Z",
    },
    {
      id: "parser-migration-wrapper-user",
      kind: "memory",
      text: migrationWrapperText,
      tags: ["codex-raw", "codex-session", "role-user", `session:${parserMigrationSession}`],
      source: `codex:session:${parserMigrationSession}`,
      createdAt: "2026-06-29T00:45:19.000Z",
    },
    {
      id: "parser-migration-orphan-wrapper",
      kind: "memory",
      text: "# Diff comments:\nLegacy immediate-hook wrapper without a transcript-identical copy.",
      tags: ["codex-raw", "codex-session", "role-user", `session:${parserMigrationSession}`],
      source: `codex:session:${parserMigrationSession}`,
      createdAt: "2026-06-29T00:45:17.000Z",
    },
  ]);
  await writeCursor(parserMigrationStoreDir, parserMigrationSession, 5, {
    transcriptFingerprint: "legacy-parser-fingerprint",
  });
  await writeFile(
    parserMigrationTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:45:18.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: migrationInjectedText }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:45:19.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: migrationWrapperText }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:45:20.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: migrationUserText }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:45:21.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "This progress update must not be captured." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:45:22.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: migrationFinalText }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: parserMigrationSession, transcript_path: parserMigrationTranscript });
  const parserMigrationRecords = await parserMigrationStore.all();
  assert.equal(parserMigrationRecords.filter((record) => record.text === migrationUserText).length, 1);
  assert.equal(parserMigrationRecords.filter((record) => record.text === migrationFinalText).length, 1);
  assert.equal(parserMigrationRecords.filter((record) => record.text === migrationUnwrappedText).length, 1);
  assert.equal(parserMigrationRecords.some((record) => record.text === migrationInjectedText), false);
  assert.equal(parserMigrationRecords.some((record) => record.text === migrationWrapperText), false);
  assert.equal(parserMigrationRecords.some((record) => record.text.includes("progress update")), false);
  const deletedCommentary = (await parserMigrationStore.all({ includeDeleted: true })).find(
    (record) => record.id === "parser-migration-commentary",
  );
  assert.equal(typeof deletedCommentary?.deletedAt, "string");
  const deletedInjectedUser = (await parserMigrationStore.all({ includeDeleted: true })).find(
    (record) => record.id === "parser-migration-injected-user",
  );
  const deletedWrapperUser = (await parserMigrationStore.all({ includeDeleted: true })).find(
    (record) => record.id === "parser-migration-wrapper-user",
  );
  const deletedOrphanWrapper = (await parserMigrationStore.all({ includeDeleted: true })).find(
    (record) => record.id === "parser-migration-orphan-wrapper",
  );
  assert.equal(typeof deletedInjectedUser?.deletedAt, "string");
  assert.equal(typeof deletedWrapperUser?.deletedAt, "string");
  assert.equal(typeof deletedOrphanWrapper?.deletedAt, "string");
  const parserMigrationCursor = JSON.parse(
    await readFile(cursorPath(parserMigrationStoreDir, parserMigrationSession), "utf8"),
  );
  assert.equal(parserMigrationCursor.count, 3);
  assert.equal(parserMigrationCursor.parserVersion, 5);

  const replacementStore = createStore("cursor-replacement");
  const replacementStoreDir = loadConfig().storeDir;
  const replacementTranscript = path.join(temp, "cursor-replacement-transcript.jsonl");
  await writeFile(
    replacementTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:46:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Original replacement turn one." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:46:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Original replacement turn two." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: "replacement-session", transcript_path: replacementTranscript });
  assert.equal(await readCursor(replacementStoreDir, "replacement-session"), 2);
  await writeFile(
    replacementTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:47:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fresh replacement turn one." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:47:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fresh replacement turn two." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: "replacement-session", transcript_path: replacementTranscript });
  const replacementRecords = await replacementStore.all();
  assert.equal(replacementRecords.some((record) => record.text === "Fresh replacement turn one."), true);
  assert.equal(replacementRecords.some((record) => record.text === "Fresh replacement turn two."), true);
  assert.equal(await readCursor(replacementStoreDir, "replacement-session"), 2);

  const rotatedStore = createStore("rotated-cursor");
  const rotatedStoreDir = loadConfig().storeDir;
  const rotatedTranscript = path.join(temp, "rotated-transcript.jsonl");
  const rotatedTranscriptContent =
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:46:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Cursor rotation fresh turn." }],
        },
      }),
    ].join("\n") + "\n";
  await rotatedStore.addRecord({
    id: deterministicId(["codex", "rotated-session", "user", "0", "Cursor rotation fresh turn."]),
    kind: "memory",
    text: "Cursor rotation fresh turn.",
    tags: ["codex-raw", "codex-session", "role-user", "session:rotated-session"],
    source: "codex:session:rotated-session",
    createdAt: "2026-06-29T00:40:00.000Z",
  });
  await writeCursor(rotatedStoreDir, "rotated-session", 5, {
    transcriptFingerprint: "replaced-transcript-fingerprint",
    parserVersion: 5,
  });
  await writeFile(rotatedTranscript, rotatedTranscriptContent, "utf8");
  await writeback({ session_id: "rotated-session", transcript_path: rotatedTranscript });
  await writeCursor(rotatedStoreDir, "rotated-session", 5, {
    transcriptFingerprint: "replaced-transcript-fingerprint",
    parserVersion: 5,
  });
  await writeFile(rotatedTranscript, rotatedTranscriptContent, "utf8");
  await utimes(rotatedTranscript, new Date("2026-06-29T00:47:00.000Z"), new Date("2026-06-29T00:47:00.000Z"));
  await writeback({ session_id: "rotated-session", transcript_path: rotatedTranscript });
  const rotatedRecords = await rotatedStore.all();
  assert.equal(rotatedRecords.filter((record) => record.text === "Cursor rotation fresh turn.").length, 2);
  assert.equal(await readCursor(rotatedStoreDir, "rotated-session"), 1);

  const assistantTrivialStore = createStore("assistant-trivial");
  const assistantTrivialStoreDir = loadConfig().storeDir;
  const assistantTrivialTranscript = path.join(temp, "assistant-trivial-transcript.jsonl");
  await writeFile(
    assistantTrivialTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:48:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Done." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: "assistant-trivial-session", transcript_path: assistantTrivialTranscript });
  assert.equal(
    (await assistantTrivialStore.all()).some((record) => record.source === "codex:session:assistant-trivial-session"),
    false,
  );
  assert.equal(await readCursor(assistantTrivialStoreDir, "assistant-trivial-session"), 1);

  const recallStore = createStore("recall");
  const recallRecordId = deterministicId(["recall", "long"]);
  const recallTail = "tail-should-not-appear";
  await recallStore.addRecord({
    id: deterministicId(["recall", "unrelated"]),
    kind: "memory",
    text: "Generic raw captured turn.",
    tags: ["codex-raw", "codex-session", "role-user", "session:other"],
    source: "codex:session:other",
    createdAt: "2026-06-29T00:00:07.000Z",
  });
  await recallStore.addRecord({
    id: deterministicId(["recall", "unrelated-project"]),
    kind: "memory",
    text: "Other project decision from a different session should not appear.",
    tags: ["codex-raw", "codex-session", "role-user", "session:other"],
    source: "codex:session:other",
    createdAt: "2026-06-29T00:00:08.000Z",
  });
  for (let index = 0; index < 40; index += 1) {
    await recallStore.addRecord({
      id: deterministicId(["recall", "generic", String(index)]),
      kind: "memory",
      text: `Other project decision filler ${index} from a different session should not appear.`,
      tags: ["codex-raw", "codex-session", "role-user", "session:other"],
      source: "codex:session:other",
      createdAt: `2026-06-29T00:01:${String(index).padStart(2, "0")}.000Z`,
    });
  }
  await recallStore.addRecord({
    id: recallRecordId,
    kind: "memory",
    text: `Legacy recall relevant project decision: OPENAI_API_KEY=${["sk", "recall", "fixture"].join("-")} ${"detail ".repeat(80)} ${recallTail}`,
    tags: ["codex-raw", "codex-session", "role-user", "session:recall-session"],
    source: "codex:session:recall-session",
    createdAt: "2026-06-29T00:00:09.000Z",
  });
  for (const [id, text, role] of [
    ["recommended", "<recommended_plugins>Pathmark plugin catalog boilerplate</recommended_plugins>", "user"],
    ["files", "# Files mentioned by the user:\nPathmark attachment transport envelope.", "user"],
    ["annotations", "# Response annotations:\nPathmark annotation transport envelope.", "user"],
    ["internal", "<codex_internal_context source=\"goal\">Pathmark internal continuation.</codex_internal_context>", "user"],
    ["progress", "I’m checking the Pathmark session-start recall records now.", "assistant"],
  ]) {
    await recallStore.addRecord({
      id: deterministicId(["recall", "low-signal", id]),
      kind: "memory",
      text,
      tags: ["codex-raw", "codex-session", `role-${role}`, "session:recall-session"],
      source: "codex:session:recall-session",
      createdAt: "2026-06-29T00:00:09.500Z",
    });
  }
  const recallOutput = await recall({
    cwd: "/workspace/pathmark",
    session_id: "recall-session",
  });
  assert.equal(recallOutput.includes("Generic raw captured turn."), false);
  assert.equal(recallOutput.includes("Other project decision from a different session"), false);
  assert.equal(recallOutput.includes("Other project decision filler"), false);
  assert.equal(recallOutput.includes("Legacy recall relevant project decision"), true);
  assert.equal(recallOutput.includes("plugin catalog boilerplate"), false);
  assert.equal(recallOutput.includes("attachment transport envelope"), false);
  assert.equal(recallOutput.includes("annotation transport envelope"), false);
  assert.equal(recallOutput.includes("internal continuation"), false);
  assert.equal(recallOutput.includes("session-start recall records now"), false);
  assert.equal(recallOutput.includes(["sk", "recall", "fixture"].join("-")), false);
  assert.equal(recallOutput.includes("[REDACTED]"), true);
  assert.equal(recallOutput.includes(recallTail), false);
  assert.equal(recallOutput.includes("Used memories:"), true);
  assert.equal(recallOutput.includes(recallRecordId), true);
  assert.equal(recallOutput.includes("createdAt:"), true);
  assert.equal(recallOutput.includes("source: codex:session:recall-session"), true);
  assert.equal(recallOutput.includes("codex-session"), false);
  assert.equal(recallOutput.includes("Store:"), true);
  assert.equal(recallOutput.includes("mcp__pathmark__recall_memory"), true);
  assert.equal(recallOutput.includes("mcp__pathmark__chat"), true);

  const noSignalStore = createStore("recall-no-signal");
  await noSignalStore.addRecord({
    id: deterministicId(["recall", "no-signal"]),
    kind: "memory",
    text: "Arbitrary recent memory must not appear without recall signals.",
    tags: ["codex-raw", "codex-session", "role-user", "session:other"],
    source: "codex:session:other",
    createdAt: "2026-06-29T00:50:00.000Z",
  });
  const noSignalRecall = await recall({});
  assert.equal(noSignalRecall.includes("Arbitrary recent memory must not appear"), false);
  assert.equal(noSignalRecall.includes("No matching Pathmark memory found."), true);
  assert.equal(noSignalRecall.includes("Store:"), true);
  assert.equal(noSignalRecall.includes("mcp__pathmark__recall_memory"), true);
  assert.equal(noSignalRecall.includes("mcp__pathmark__chat"), true);

  createStore("project-recall");
  await prompt({
    cwd: "/workspace/pathmark",
    session_id: "project-session-a",
    prompt: "Remember alpha workspace behavior.",
  });
  const projectRecall = await recall({
    cwd: "/workspace/pathmark",
    session_id: "project-session-b",
  });
  assert.equal(projectRecall.includes("alpha workspace behavior"), true);

  const workspaceRecallStore = createStore("workspace-recall");
  await prompt({
    cwd: "/tmp/api",
    session_id: "api-session-a",
    prompt: "Remember beta endpoint behavior.",
  });
  await prompt({
    cwd: "/other/api",
    session_id: "api-session-b",
    prompt: "Remember gamma endpoint behavior.",
  });
  await workspaceRecallStore.addRecord({
    id: deterministicId(["workspace-recall", "legacy-project-only"]),
    kind: "memory",
    text: "Legacy project-only api note must not leak.",
    tags: ["codex-raw", "codex-session", "role-user", "session:other", "project:api"],
    source: "codex:session:other",
    createdAt: "2026-06-29T00:55:00.000Z",
  });
  await workspaceRecallStore.addRecord({
    id: deterministicId(["workspace-recall", "legacy-untagged"]),
    kind: "memory",
    text: "Legacy untagged api note must not leak.",
    tags: ["codex-raw", "codex-session", "role-user", "session:other"],
    source: "codex:session:other",
    createdAt: "2026-06-29T00:55:01.000Z",
  });
  const tmpApiRecall = await recall({
    cwd: "/tmp/api",
    session_id: "api-session-c",
  });
  assert.equal(tmpApiRecall.includes("beta endpoint behavior"), true);
  assert.equal(tmpApiRecall.includes("gamma endpoint behavior"), false);
  assert.equal(tmpApiRecall.includes("Legacy project-only api note"), false);
  assert.equal(tmpApiRecall.includes("Legacy untagged api note"), false);
  const otherApiRecall = await recall({
    cwd: "/other/api",
    session_id: "api-session-d",
  });
  assert.equal(otherApiRecall.includes("gamma endpoint behavior"), true);
  assert.equal(otherApiRecall.includes("beta endpoint behavior"), false);
  assert.equal(otherApiRecall.includes("Legacy project-only api note"), false);
  assert.equal(otherApiRecall.includes("Legacy untagged api note"), false);

  const generalRecallStore = createStore("general-recall");
  await generalRecallStore.addRecord({
    id: deterministicId(["general-recall", "session-only"]),
    kind: "memory",
    text: "General session recall remains usable.",
    tags: ["codex-raw", "codex-session", "role-user", "session:general-session"],
    source: "codex:session:general-session",
    createdAt: "2026-06-29T00:56:00.000Z",
  });
  const generalRecall = await recall({ session_id: "general-session" });
  assert.equal(generalRecall.includes("General session recall remains usable."), true);

  const previousCodexHome = process.env.CODEX_HOME;
  const previousStoreDir = process.env.PATHMARK_STORE_DIR;
  try {
    process.env.CODEX_HOME = "";
    process.env.PATHMARK_STORE_DIR = "";
    const defaultCodexHome = path.join(os.homedir(), ".codex");
    const defaultStoreDir = path.join(os.homedir(), ".pathmark", "memory");
    assert.equal(codexHome(), defaultCodexHome);
    assert.equal(codexHooksPath(), path.join(defaultCodexHome, "hooks.json"));
    assert.equal(codexConfigPath(), path.join(defaultCodexHome, "config.toml"));
    assert.equal(pathmarkStoreDir(), defaultStoreDir);
    assert.equal(codexCursorDir(), path.join(defaultStoreDir, "codex-cursors"));
    assert.notEqual(codexHome(), process.cwd());
    assert.notEqual(pathmarkStoreDir(), process.cwd());

    const emptyEnvConfigPath = path.join(temp, "empty-env-codex-config.toml");
    await installPathmarkMcp(emptyEnvConfigPath);
    const emptyEnvConfig = await readFile(emptyEnvConfigPath, "utf8");
    assert.equal(emptyEnvConfig.includes(`PATHMARK_STORE_DIR = ${JSON.stringify(defaultStoreDir)}`), true);
    assert.equal(emptyEnvConfig.includes(`PATHMARK_STORE_DIR = ${JSON.stringify(process.cwd())}`), false);
  } finally {
    restoreEnv("CODEX_HOME", previousCodexHome);
    restoreEnv("PATHMARK_STORE_DIR", previousStoreDir);
  }

  const codexHomeDir = path.join(temp, "codex-home");
  const installerStoreDir = path.join(temp, "installer-store");
  process.env.CODEX_HOME = codexHomeDir;
  process.env.PATHMARK_STORE_DIR = installerStoreDir;
  assert.equal(codexHome(), codexHomeDir);
  assert.equal(codexHooksPath(), path.join(codexHomeDir, "hooks.json"));
  assert.equal(codexConfigPath(), path.join(codexHomeDir, "config.toml"));
  assert.equal(pathmarkStoreDir(), installerStoreDir);
  assert.equal(codexCursorDir(), path.join(installerStoreDir, "codex-cursors"));
  await mkdir(codexHomeDir, { recursive: true });

  const legacyDataDir = path.join(temp, "legacy-data");
  await mkdir(legacyDataDir, { recursive: true });
  await writeFile(path.join(legacyDataDir, "memory.jsonl"), '{"kept":true}\n', "utf8");

  const hooksPath = path.join(codexHomeDir, "hooks.json");
  await writeFile(
    hooksPath,
    JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [
                { type: "command", command: "pathmark codex recall", timeout: 1 },
                { type: "command", command: "echo existing-session-start" },
              ],
            },
          ],
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "node /home/user/.codex/legacy/codex-legacy.mjs prompt" }] },
            { hooks: [{ type: "command", command: "echo keep-me" }] },
          ],
          Stop: [{ hooks: [{ type: "command", command: "pathmark codex writeback" }] }],
          OtherEvent: [{ matcher: "*", hooks: [{ type: "command", command: "echo unrelated" }], custom: true }],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  assert.deepEqual(await hookStatus(hooksPath), { pathmark: true, legacy: true });
  await installPathmarkHooks({ replaceLegacyHooks: true, hooksPath });
  assert.deepEqual(await hookStatus(hooksPath), { pathmark: true, legacy: false });
  const firstInstalledHooksText = await readFile(hooksPath, "utf8");
  assert.equal(firstInstalledHooksText.includes("echo existing-session-start"), true);
  assert.equal(firstInstalledHooksText.includes('"PostToolUseFailure"'), true);
  assert.equal(firstInstalledHooksText.includes("echo keep-me"), true);
  assert.equal(firstInstalledHooksText.includes("echo unrelated"), true);
  assert.equal(firstInstalledHooksText.includes("codex-legacy"), false);
  assert.equal(pathmarkHookCommandCount(firstInstalledHooksText), 6);
  assert.equal((await readFile(path.join(legacyDataDir, "memory.jsonl"), "utf8")).includes('"kept":true'), true);
  assert.equal((await readdir(codexHomeDir)).some((name) => name.startsWith("hooks.json.backup-")), true);

  await installPathmarkHooks({ replaceLegacyHooks: true, hooksPath });
  assert.equal(await readFile(hooksPath, "utf8"), firstInstalledHooksText);

  await uninstallPathmarkHooks(hooksPath);
  const uninstalledHooksText = await readFile(hooksPath, "utf8");
  assert.deepEqual(await hookStatus(hooksPath), { pathmark: false, legacy: false });
  assert.equal(uninstalledHooksText.includes("echo existing-session-start"), true);
  assert.equal(uninstalledHooksText.includes("echo keep-me"), true);
  assert.equal(uninstalledHooksText.includes("echo unrelated"), true);

  const preserveLegacyHooksPath = path.join(codexHomeDir, "preserve-legacy-hooks.json");
  await writeFile(
    preserveLegacyHooksPath,
    JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "node /home/user/.codex/legacy/codex-legacy.mjs prompt" }] },
            { hooks: [{ type: "command", command: "echo keep-legacy-test" }] },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await installPathmarkHooks({ replaceLegacyHooks: false, hooksPath: preserveLegacyHooksPath });
  assert.deepEqual(await hookStatus(preserveLegacyHooksPath), { pathmark: true, legacy: true });
  await uninstallPathmarkHooks(preserveLegacyHooksPath);
  const preserveLegacyText = await readFile(preserveLegacyHooksPath, "utf8");
  assert.deepEqual(await hookStatus(preserveLegacyHooksPath), { pathmark: false, legacy: true });
  assert.equal(preserveLegacyText.includes("codex-legacy"), true);
  assert.equal(preserveLegacyText.includes("echo keep-legacy-test"), true);

  const configPath = path.join(codexHomeDir, "config.toml");
  await writeFile(
    configPath,
    [
      'model = "gpt-5"',
      "",
      "[features]",
      "experimental = true",
      "hooks = false",
      "",
      "[mcp_servers.other]",
      'command = "other"',
      "",
    ].join("\n"),
    "utf8",
  );
  await installPathmarkMcp(configPath);
  assert.equal(await hasPathmarkMcp(configPath), true);
  assert.deepEqual(await pathmarkMcpStatus(configPath), { installed: true, hooksFeatureEnabled: true });
  const firstInstalledConfig = await readFile(configPath, "utf8");
  assert.equal(firstInstalledConfig.includes("experimental = true"), true);
  assert.equal(firstInstalledConfig.includes("hooks = true"), true);
  assert.equal(firstInstalledConfig.includes("[mcp_servers.other]"), true);
  assert.equal(firstInstalledConfig.includes("[mcp_servers.pathmark]"), true);
  assert.equal(firstInstalledConfig.includes(`PATHMARK_STORE_DIR = ${JSON.stringify(installerStoreDir)}`), true);

  await installPathmarkMcp(configPath);
  assert.equal(await readFile(configPath, "utf8"), firstInstalledConfig);

  await removePathmarkMcp(configPath);
  assert.equal(await hasPathmarkMcp(configPath), false);
  const removedConfig = await readFile(configPath, "utf8");
  assert.equal(removedConfig.includes("[mcp_servers.pathmark]"), false);
  assert.equal(removedConfig.includes("[mcp_servers.other]"), true);
  assert.equal(removedConfig.includes("hooks = true"), true);
  await removePathmarkMcp(configPath);
  assert.equal(await readFile(configPath, "utf8"), removedConfig);

  const legacyPathmarkConfigPath = path.join(codexHomeDir, "legacy-pathmark-config.toml");
  await writeFile(
    legacyPathmarkConfigPath,
    [
      'model = "gpt-5"',
      "",
      "[mcp_servers.pathmark]",
      'command = "pathmark"',
      "",
      "[mcp_servers.pathmark.env]",
      'PATHMARK_STORE_DIR = "/home/user/.pathmark/memory"',
      'PATHMARK_SYNTHESIS_PROVIDER = "client"',
      "",
      "[mcp_servers.other]",
      'command = "other"',
      "",
      "[mcp_servers.other.env]",
      'KEEP = "yes"',
      "",
      '[projects."/tmp/pathmark-kept"]',
      "trusted = true",
      "",
    ].join("\n"),
    "utf8",
  );
  await installPathmarkMcp(legacyPathmarkConfigPath);
  const migratedPathmarkConfig = await readFile(legacyPathmarkConfigPath, "utf8");
  assert.equal(tomlTableHeaderCount(migratedPathmarkConfig, "mcp_servers.pathmark"), 1);
  assert.equal(tomlTableHeaderCount(migratedPathmarkConfig, "mcp_servers.pathmark.env"), 1);
  assert.equal(migratedPathmarkConfig.includes("# >>> pathmark MCP >>>"), false);
  assert.equal(migratedPathmarkConfig.includes('PATHMARK_STORE_DIR = "/home/user/.pathmark/memory"'), true);
  assert.equal(migratedPathmarkConfig.includes("[mcp_servers.other]"), true);
  assert.equal(migratedPathmarkConfig.includes("[mcp_servers.other.env]"), true);
  assert.equal(migratedPathmarkConfig.includes('[projects."/tmp/pathmark-kept"]'), true);
  assert.equal((await readdir(codexHomeDir)).some((name) => name.startsWith("legacy-pathmark-config.toml.backup-")), true);

  await removePathmarkMcp(legacyPathmarkConfigPath);
  const removedMigratedPathmarkConfig = await readFile(legacyPathmarkConfigPath, "utf8");
  assert.equal(tomlTableHeaderCount(removedMigratedPathmarkConfig, "mcp_servers.pathmark"), 1);
  assert.equal(tomlTableHeaderCount(removedMigratedPathmarkConfig, "mcp_servers.pathmark.env"), 1);
  assert.equal(removedMigratedPathmarkConfig.includes("[mcp_servers.other]"), true);
  assert.equal(removedMigratedPathmarkConfig.includes("[mcp_servers.other.env]"), true);
  assert.equal(removedMigratedPathmarkConfig.includes('[projects."/tmp/pathmark-kept"]'), true);

  const cliCodexHome = path.join(temp, "cli-codex-home");
  const cliStoreDir = path.join(temp, "cli-store");
  const cliLegacyDataDir = path.join(temp, "cli-legacy-data");
  await mkdir(cliCodexHome, { recursive: true });
  await mkdir(cliLegacyDataDir, { recursive: true });
  await writeFile(path.join(cliLegacyDataDir, "memory.jsonl"), '{"kept":true}\n', "utf8");
  await writeFile(
    path.join(cliCodexHome, "hooks.json"),
    JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "node /home/user/.codex/legacy/codex-legacy.mjs prompt" }] },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const cliEnv = {
    ...process.env,
    CODEX_HOME: cliCodexHome,
    PATHMARK_STORE_DIR: cliStoreDir,
  };
  const initialStatusRun = runCli(["status"], { env: cliEnv });
  assert.equal(initialStatusRun.status, 0, initialStatusRun.stderr);
  const initialStatus = JSON.parse(initialStatusRun.stdout);
  assert.equal(initialStatus.pathmarkHooksInstalled, false);
  assert.equal(initialStatus.pathmarkMcpRegistered, false);
  assert.equal(initialStatus.codexHooksFeatureEnabled, false);
  assert.equal(initialStatus.legacyHooksPresent, true);
  assert.equal(initialStatus.storeDir, cliStoreDir);
  assert.equal(initialStatus.memoryFile, path.join(cliStoreDir, "memory.jsonl"));
  assert.equal(typeof initialStatus.recordCount, "number");

  const installRun = runCli(["install", "--replace-legacy-hooks"], { env: cliEnv });
  assert.equal(installRun.status, 0, installRun.stderr);
  assert.equal(installRun.stdout.includes("Installed Pathmark Codex hooks and MCP server."), true);
  const installedStatusRun = runCli(["status"], { env: cliEnv });
  assert.equal(installedStatusRun.status, 0, installedStatusRun.stderr);
  const installedStatus = JSON.parse(installedStatusRun.stdout);
  assert.equal(installedStatus.pathmarkHooksInstalled, true);
  assert.equal(installedStatus.pathmarkMcpRegistered, true);
  assert.equal(installedStatus.codexHooksFeatureEnabled, true);
  assert.equal(installedStatus.legacyHooksPresent, false);
  assert.equal((await readFile(path.join(cliCodexHome, "hooks.json"), "utf8")).includes("codex-legacy"), false);
  assert.equal((await readFile(path.join(cliLegacyDataDir, "memory.jsonl"), "utf8")).includes('"kept":true'), true);

  const promptRun = runCli(["prompt"], {
    env: cliEnv,
    input: JSON.stringify({
      cwd: "/tmp/pathmark-cli",
      session_id: "cli-session",
      prompt: "Remember the CLI capture path.",
    }),
  });
  assert.equal(promptRun.status, 0, promptRun.stderr);
  const promptOutput = JSON.parse(promptRun.stdout);
  assert.equal(promptOutput.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.equal(promptOutput.hookSpecificOutput.additionalContext.includes("<pathmark-memory-nudge>"), true);

  const promptStatusRun = runCli(["status"], { env: cliEnv });
  assert.equal(promptStatusRun.status, 0, promptStatusRun.stderr);
  assert.equal(JSON.parse(promptStatusRun.stdout).recordCount, 1);

  const recallRun = runCli(["recall"], {
    env: cliEnv,
    input: JSON.stringify({
      cwd: "/tmp/pathmark-cli",
      session_id: "cli-session",
    }),
  });
  assert.equal(recallRun.status, 0, recallRun.stderr);
  const cliRecallOutput = JSON.parse(recallRun.stdout);
  assert.equal(cliRecallOutput.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(cliRecallOutput.hookSpecificOutput.additionalContext.includes("CLI capture path"), true);

  const observeRun = runCli(["observe"], {
    env: cliEnv,
    input: JSON.stringify({
      session_id: "cli-session",
      tool_name: "functions.exec_command",
      tool_input: { cmd: "npm test" },
    }),
  });
  assert.equal(observeRun.status, 0, observeRun.stderr);
  assert.equal(observeRun.stdout, "");

  const cliTranscript = path.join(temp, "cli-transcript.jsonl");
  await writeFile(
    cliTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T01:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "CLI writeback durable turn." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  const writebackRun = runCli(["writeback"], {
    env: cliEnv,
    input: JSON.stringify({
      session_id: "cli-writeback-session",
      transcript_path: cliTranscript,
    }),
  });
  assert.equal(writebackRun.status, 0, writebackRun.stderr);
  assert.equal(writebackRun.stdout, "");
  const writebackStatusRun = runCli(["status"], { env: cliEnv });
  assert.equal(writebackStatusRun.status, 0, writebackStatusRun.stderr);
  assert.equal(JSON.parse(writebackStatusRun.stdout).recordCount, 3);

  const invalidRun = runCli(["recall"], { env: cliEnv, input: "{not-json" });
  assert.equal(invalidRun.status, 0, invalidRun.stderr);
  assert.equal(invalidRun.stdout, "");
  assert.equal(invalidRun.stderr, "");

  const unknownRun = runCli(["unknown"], { env: cliEnv });
  assert.equal(unknownRun.status, 2);
  assert.equal(unknownRun.stderr.includes("Usage: pathmark codex"), true);

  const uninstallRun = runCli(["uninstall"], { env: cliEnv });
  assert.equal(uninstallRun.status, 0, uninstallRun.stderr);
  assert.equal(uninstallRun.stdout.includes("Removed Pathmark Codex hooks and MCP server registration."), true);
  const uninstalledStatusRun = runCli(["status"], { env: cliEnv });
  assert.equal(uninstalledStatusRun.status, 0, uninstalledStatusRun.stderr);
  const uninstalledStatus = JSON.parse(uninstalledStatusRun.stdout);
  assert.equal(uninstalledStatus.pathmarkHooksInstalled, false);
  assert.equal(uninstalledStatus.pathmarkMcpRegistered, false);
  assert.equal(uninstalledStatus.legacyHooksPresent, false);
  assert.equal((await readFile(path.join(cliLegacyDataDir, "memory.jsonl"), "utf8")).includes('"kept":true'), true);

  console.log("Codex adapter base tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}

function createStore(name) {
  process.env.PATHMARK_STORE_DIR = path.join(temp, name);
  return new PathmarkStore(loadConfig());
}

async function jsonlLines(name) {
  const file = await readFile(path.join(temp, name, "memory.jsonl"), "utf8");
  return file.trim() ? file.trim().split("\n") : [];
}

function pathmarkHookCommandCount(hooksText) {
  const parsed = JSON.parse(hooksText);
  return Object.values(parsed.hooks)
    .flatMap((groups) => groups.flatMap((group) => group.hooks ?? []))
    .filter((hook) => typeof hook.command === "string" && /\bpathmark\b[\s\S]*\bcodex\b/.test(hook.command)).length;
}

function tomlTableHeaderCount(content, dottedName) {
  const pattern = new RegExp(`^\\s*\\[\\s*${dottedName.replaceAll(".", "\\s*\\.\\s*")}\\s*\\]\\s*(?:#.*)?$`);
  return content.split("\n").filter((line) => pattern.test(line)).length;
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, ["dist/index.js", "codex", ...args], {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
  });
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
