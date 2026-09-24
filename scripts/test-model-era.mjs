import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = await mkdtemp(path.join(os.tmpdir(), "pathmark-model-era-"));
const storeDir = path.join(root, "store");
const baseEnv = { ...process.env, PATHMARK_STORE_DIR: storeDir };

try {
  await testServerInstructionsAndAnnotations();
  await testClaudeCodeHooks();
  await testClaudeSynthesisPreset();
  await testClaudeCodeNativeImport();
  console.log("Model-era capability tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}

async function withClient(env, run) {
  const client = new Client({ name: "pathmark-model-era-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env }));
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

async function testServerInstructionsAndAnnotations() {
  await withClient(baseEnv, async (client) => {
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /recall_memory/);
    assert.match(instructions, /create_conclusion/);
    assert.match(instructions, /untrusted/);
    assert.equal(client.getServerVersion()?.title, "Pathmark");

    const { tools } = await client.listTools();
    const missing = tools.filter((tool) => typeof tool.annotations?.readOnlyHint !== "boolean").map((tool) => tool.name);
    assert.deepEqual(missing, [], `tools without annotations: ${missing.join(", ")}`);
    const byName = new Map(tools.map((tool) => [tool.name, tool.annotations]));
    for (const name of ["recall_memory", "search_memory", "get_context", "doctor_memory", "ask_memory", "chat"]) {
      assert.equal(byName.get(name).readOnlyHint, true, `${name} should be read-only`);
    }
    for (const name of ["purge_memory", "compact_memory", "delete_memory"]) {
      assert.equal(byName.get(name).destructiveHint, true, `${name} should be destructive`);
    }
    assert.equal(byName.get("remember").readOnlyHint, false);
    assert.equal(byName.get("ask_memory").openWorldHint, false, "client synthesis stays local");
    assert.equal(byName.get("consolidate_memory").openWorldHint, false);
  });

  await withClient({ ...baseEnv, PATHMARK_SYNTHESIS_PROVIDER: "claude" }, async (client) => {
    const { tools } = await client.listTools();
    for (const name of ["ask_memory", "chat", "consolidate_memory"]) {
      assert.equal(tools.find((tool) => tool.name === name).annotations.openWorldHint, true, `${name} uses external synthesis`);
    }
  });
}

async function testClaudeCodeHooks() {
  const cwd = path.join(root, "claude-project");
  const transcript = path.join(root, "claude-transcript.jsonl");
  await writeFile(
    transcript,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "Fix it" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Earlier text." }] } }),
      "{not json",
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Transcript fallback reply about the vitest migration." }] },
      }),
      JSON.stringify({
        type: "assistant",
        isSidechain: true,
        message: { role: "assistant", content: [{ type: "text", text: "Subagent chatter that must be ignored." }] },
      }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash" }] } }),
    ].join("\n"),
  );

  const direct = runHook("after-agent", {
    session_id: "claude-session",
    cwd,
    hook_event_name: "Stop",
    last_assistant_message: "Direct Stop reply about the release checklist.",
  });
  assert.equal(direct.status, 0, direct.stderr);
  const fallback = runHook("after-agent", {
    session_id: "claude-session-2",
    cwd,
    hook_event_name: "Stop",
    transcript_path: transcript,
  });
  assert.equal(fallback.status, 0, fallback.stderr);
  const missing = runHook("after-agent", {
    session_id: "claude-session-3",
    cwd,
    hook_event_name: "Stop",
    transcript_path: path.join(root, "does-not-exist.jsonl"),
  });
  assert.equal(missing.status, 0, missing.stderr);

  const { lastAssistantText } = await import("../dist/hook-cli.js");
  assert.equal(await lastAssistantText(transcript), "Transcript fallback reply about the vitest migration.");

  const texts = await storeTexts();
  assert.equal(texts.some((text) => text.includes("Direct Stop reply")), true);
  assert.equal(texts.some((text) => text.includes("Transcript fallback reply")), true);
  assert.equal(texts.some((text) => text.includes("Subagent chatter")), false);

  const start = runHook("session-start", { session_id: "claude-new", cwd, hook_event_name: "SessionStart", source: "compact" });
  assert.equal(start.status, 0, start.stderr);
  const output = JSON.parse(start.stdout);
  if (output.hookSpecificOutput) {
    assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
    assert.equal(/(?<!mcp__pathmark__)\brecall_memory\b/.test(output.hookSpecificOutput.additionalContext), false);
  }

  const setup = spawnSync(process.execPath, ["dist/index.js", "setup", "claude-code", "--json"], { env: baseEnv, encoding: "utf8" });
  assert.equal(setup.status, 0, setup.stderr);
  const guide = JSON.parse(setup.stdout);
  assert.match(guide.commands[0], /^claude mcp add --scope user pathmark /);
  const hooks = guide.config.hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ["PostToolUse", "SessionStart", "Stop", "UserPromptSubmit"]);
  assert.match(hooks.SessionStart[0].matcher, /compact/);
  for (const entries of Object.values(hooks)) {
    for (const hook of entries[0].hooks) {
      assert.match(hook.command, /--client=claude-code$/);
      assert.ok(hook.timeout <= 60, "Claude Code hook timeouts are seconds");
    }
  }
}

async function testClaudeSynthesisPreset() {
  const fakeDir = path.join(root, "fake-claude");
  await mkdir(fakeDir, { recursive: true });
  const argsLog = path.join(fakeDir, "args.json");
  const fake = path.join(fakeDir, "claude");
  await writeFile(
    fake,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const stdin = fs.readFileSync(0, "utf8");',
      "fs.writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), leaked: Object.keys(process.env).filter((key) => key.startsWith(\"PATHMARK_\")), stdin }));",
      'if (process.env.FAKE_CLAUDE_FAIL) { process.stdout.write(JSON.stringify({ type: "result", is_error: true, result: "Failed to authenticate" })); process.exit(1); }',
      'process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "  Vitest, per memory.  " }));',
    ].join("\n"),
  );
  await chmod(fake, 0o755);

  const { synthesizeWithCommand } = await import("../dist/chat.js");
  const config = {
    synthesisProvider: "claude",
    claudeCommand: fake,
    claudeModel: "fable",
    chatTimeoutMs: 10_000,
  };
  const context = [
    {
      score: 1,
      record: { id: "m1", kind: "memory", text: "Project zeta uses vitest.", tags: [], createdAt: "2026-09-01T00:00:00Z" },
    },
  ];
  process.env.FAKE_CLAUDE_LOG = argsLog;
  process.env.PATHMARK_OPENAI_API_KEY = "must-not-leak";
  try {
    const answer = await synthesizeWithCommand({ config, question: "Which runner?", context });
    assert.equal(answer, "Vitest, per memory.");
    const { args, cwd, leaked, stdin } = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(argsLog, "utf8")));
    assert.deepEqual(leaked, []);
    assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.equal(args.includes("--strict-mcp-config"), true);
    assert.equal(args.includes("--no-session-persistence"), true);
    assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]), { disableAllHooks: true });
    assert.equal(args[args.indexOf("--model") + 1], "fable");
    assert.equal(path.basename(cwd), "pathmark-claude-synthesis");
    assert.match(stdin, /untrusted data/);

    process.env.FAKE_CLAUDE_FAIL = "1";
    await assert.rejects(synthesizeWithCommand({ config, question: "Which runner?", context }), /Failed to authenticate/);
  } finally {
    delete process.env.FAKE_CLAUDE_LOG;
    delete process.env.FAKE_CLAUDE_FAIL;
    delete process.env.PATHMARK_OPENAI_API_KEY;
  }
}

async function testClaudeCodeNativeImport() {
  const projectsRoot = path.join(root, "claude-projects");
  const realProject = path.join(root, "work", "my app");
  await mkdir(realProject, { recursive: true });

  const withTranscript = path.join(projectsRoot, "-transcript-project");
  await mkdir(path.join(withTranscript, "memory"), { recursive: true });
  await writeFile(path.join(withTranscript, "s1.jsonl"), `${JSON.stringify({ type: "user", cwd: realProject })}\n`);
  await writeFile(path.join(withTranscript, "memory", "MEMORY.md"), "- [Index](x.md) — index only\n");
  await writeFile(
    path.join(withTranscript, "memory", "feedback_tests.md"),
    "---\nname: feedback-tests\ndescription: Run the full suite before claiming done\nmetadata:\n  type: feedback\n---\n\nAlways run npm test before saying a task is finished. token=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789\n",
  );

  const slug = realProject.replace(/[^A-Za-z0-9]/g, "-");
  const slugOnly = path.join(projectsRoot, slug);
  await mkdir(path.join(slugOnly, "memory"), { recursive: true });
  await writeFile(path.join(slugOnly, "memory", "project_db.md"), "---\nname: db\ntype: project\n---\nThe app uses SQLite in WAL mode.\n");

  const { resolveSlugPath, parseMemoryMarkdown } = await import("../dist/native-memory.js");
  assert.equal(await resolveSlugPath(slug), realProject);
  assert.equal(await resolveSlugPath("-definitely-not-a-real-path-xyz"), undefined);
  assert.deepEqual(parseMemoryMarkdown("No frontmatter body.", "fallback"), { name: "fallback", type: undefined, text: "No frontmatter body." });

  const run = (...extra) => {
    const result = spawnSync(process.execPath, ["dist/index.js", "import-native", "claude-code", `--root=${projectsRoot}`, ...extra], {
      env: baseEnv,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  assert.equal(run("--dry-run").created, 2);
  assert.equal((await storeRecords()).some((record) => record.tags.includes("claude-code-memory")), false, "dry run writes nothing");

  const first = run();
  assert.deepEqual([first.scanned, first.created, first.updated, first.unchanged], [2, 2, 0, 0]);
  const imported = (await storeRecords()).filter((record) => record.tags.includes("claude-code-memory"));
  assert.equal(imported.length, 2);
  assert.equal(imported.every((record) => record.kind === "memory"), true, "imports are evidence, not conclusions");
  const feedback = imported.find((record) => record.text.includes("npm test"));
  assert.equal(feedback.tags.includes("memory-type:feedback"), true);
  assert.equal(feedback.tags.includes("project:my-app"), true);
  assert.equal(feedback.text.includes("sk-ant-api03"), false, "secrets are redacted");
  assert.match(feedback.text, /^Run the full suite before claiming done/);
  const db = imported.find((record) => record.text.includes("SQLite"));
  assert.equal(db.tags.includes("project:my-app"), true, "slug resolved through the filesystem");

  const second = run();
  assert.deepEqual([second.created, second.updated, second.unchanged], [0, 0, 2]);

  await writeFile(path.join(slugOnly, "memory", "project_db.md"), "---\nname: db\ntype: project\n---\nThe app moved to Postgres 17.\n");
  const third = run();
  assert.deepEqual([third.created, third.updated, third.unchanged], [0, 1, 1]);
  const updated = (await storeRecords()).find((record) => record.id === db.id);
  assert.match(updated.text, /Postgres 17/);

  const { PathmarkStore } = await import("../dist/store.js");
  const { loadConfig } = await import("../dist/config.js");
  process.env.PATHMARK_STORE_DIR = storeDir;
  await new PathmarkStore(loadConfig()).delete(db.id);
  const fourth = run();
  assert.equal(fourth.deletedInPathmark, 1);
  assert.equal(fourth.created, 0, "a record deleted in Pathmark is not resurrected");
}

function runHook(event, input) {
  return spawnSync(process.execPath, ["dist/index.js", "hook", event, "--client=claude-code"], {
    env: baseEnv,
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}

async function storeRecords() {
  const { PathmarkStore } = await import("../dist/store.js");
  const { loadConfig } = await import("../dist/config.js");
  process.env.PATHMARK_STORE_DIR = storeDir;
  return new PathmarkStore(loadConfig()).all();
}

async function storeTexts() {
  return (await storeRecords()).map((record) => record.text);
}
