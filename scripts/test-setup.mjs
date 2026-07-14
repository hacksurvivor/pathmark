import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const env = {
  ...process.env,
  PATHMARK_STORE_DIR: "",
};
const defaultStoreDir = path.join(os.homedir(), ".pathmark", "memory");

const listRun = runSetup(["list"]);
assert.equal(listRun.status, 0, listRun.stderr);
assert.equal(listRun.stdout.includes("claude-code"), true);
assert.equal(listRun.stdout.includes("opencode"), true);
assert.equal(listRun.stdout.includes("gemini-cli"), true);

const claudeRun = runSetup(["claude-code"]);
assert.equal(claudeRun.status, 0, claudeRun.stderr);
assert.equal(claudeRun.stdout.includes("claude mcp add pathmark -- pathmark"), true);
assert.equal(claudeRun.stdout.includes(defaultStoreDir), true);
assert.equal(claudeRun.stdout.includes(process.cwd()), false);

const opencodeRun = runSetup(["opencode", "--json"]);
assert.equal(opencodeRun.status, 0, opencodeRun.stderr);
const opencode = JSON.parse(opencodeRun.stdout);
assert.equal(opencode.target, "opencode");
assert.deepEqual(opencode.config.mcp.pathmark.command, ["pathmark"]);
assert.equal(opencode.config.mcp.pathmark.environment.PATHMARK_STORE_DIR, defaultStoreDir);

const geminiRun = runSetup(["gemini", "--json"]);
assert.equal(geminiRun.status, 0, geminiRun.stderr);
const gemini = JSON.parse(geminiRun.stdout);
assert.equal(gemini.target, "gemini-cli");
assert.equal(gemini.config.mcpServers.pathmark.command, "pathmark");
assert.equal(gemini.config.hooks.BeforeAgent[0].hooks[0].command, "pathmark hook before-agent");
assert.equal(gemini.config.hooks.AfterAgent[0].hooks[0].command, "pathmark hook after-agent");

const kimiRun = runSetup(["kimi", "--json"]);
assert.equal(kimiRun.status, 0, kimiRun.stderr);
const kimi = JSON.parse(kimiRun.stdout);
assert.equal(kimi.target, "openai-compatible");
assert.equal(kimi.env.PATHMARK_SYNTHESIS_PROVIDER, "openai-compatible");
assert.equal(kimi.env.PATHMARK_STORE_DIR, defaultStoreDir);

const unknownRun = runSetup(["not-a-client"]);
assert.equal(unknownRun.status, 2);
assert.equal(unknownRun.stderr.includes("Unknown setup target"), true);

const topHelpRun = runPathmark(["--help"]);
assert.equal(topHelpRun.status, 0, topHelpRun.stderr);
assert.equal(topHelpRun.stdout.includes("No arguments starts the Pathmark MCP stdio server."), true);

const topUnknownRun = runPathmark(["not-a-command"]);
assert.equal(topUnknownRun.status, 2);
assert.equal(topUnknownRun.stderr.includes("Unknown command"), true);

console.log("Setup tests passed");

function runSetup(args) {
  return runPathmark(["setup", ...args]);
}

function runPathmark(args) {
  return spawnSync(process.execPath, ["dist/index.js", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}
