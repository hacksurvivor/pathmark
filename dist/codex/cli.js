import { loadConfig } from "../config.js";
import { PathmarkStore, closeOpenStores } from "../store.js";
import { observe, prompt, recall, writeback } from "./capture.js";
import { installPathmarkMcp, pathmarkMcpStatus, removePathmarkMcp } from "./config-file.js";
import { hookStatus, installPathmarkHooks, uninstallPathmarkHooks } from "./hooks.js";
const USAGE = "Usage: pathmark codex <install|uninstall|status|recall|prompt|observe|writeback>";
export async function runCodexCommand(args) {
    const [command, ...rest] = args;
    if (command === "install") {
        await installPathmarkHooks({ replaceLegacyHooks: rest.includes("--replace-legacy-hooks") });
        await installPathmarkMcp();
        console.log("Installed Pathmark Codex hooks and MCP server.");
        return;
    }
    if (command === "uninstall") {
        await uninstallPathmarkHooks();
        await removePathmarkMcp();
        console.log("Removed Pathmark Codex hooks and MCP server registration.");
        return;
    }
    if (command === "status") {
        await printStatus();
        return;
    }
    if (isHookCommand(command)) {
        await runHook(command);
        return;
    }
    console.error(USAGE);
    process.exitCode = 2;
}
async function runHook(command) {
    try {
        const input = await readHookInput();
        if (!input)
            return;
        const output = command === "recall"
            ? await recall(input)
            : command === "prompt"
                ? await prompt(input)
                : command === "observe"
                    ? await observe(input)
                    : await writeback(input);
        if (!output)
            return;
        if (command === "recall" || command === "prompt") {
            process.stdout.write(`${JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: command === "recall" ? "SessionStart" : "UserPromptSubmit",
                    additionalContext: output,
                },
            })}\n`);
            return;
        }
        process.stdout.write(`${output}\n`);
    }
    finally {
        // Hook processes are one-shot. Releasing the index connection here lets the
        // WAL checkpoint and lets the process exit instead of accumulating.
        await closeOpenStores();
    }
}
async function printStatus() {
    const config = loadConfig();
    const store = new PathmarkStore(config);
    const [hooks, mcp, recordCount, health] = await Promise.all([
        hookStatus(),
        pathmarkMcpStatus(),
        store.count(),
        store.health(),
    ]);
    console.log(JSON.stringify({
        pathmarkHooksInstalled: hooks.pathmark,
        pathmarkMcpRegistered: mcp.installed,
        codexHooksFeatureEnabled: mcp.hooksFeatureEnabled,
        legacyHooksPresent: hooks.legacy,
        storeDir: config.storeDir,
        memoryFile: config.memoryFile,
        recordCount,
        invalidRecordCount: health.invalidRecordCount,
        indexFile: health.indexFile,
    }, null, 2));
}
async function readHookInput() {
    if (process.stdin.isTTY)
        return {};
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (!isHookInput(parsed))
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
function isHookCommand(command) {
    return command === "recall" || command === "prompt" || command === "observe" || command === "writeback";
}
function isHookInput(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=cli.js.map