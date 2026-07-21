import { captureExternalTurn, observe, prompt, recall } from "./codex/capture.js";
export async function runPortableHook(event) {
    if (!isHookEvent(event))
        throw new Error("Usage: pathmark hook <session-start|before-agent|after-tool|after-agent>");
    const input = await readInput();
    const common = {
        session_id: stringField(input, "session_id") ?? stringField(input, "sessionId"),
        cwd: stringField(input, "cwd"),
        transcript_path: stringField(input, "transcript_path"),
        prompt: stringField(input, "prompt"),
        tool_name: stringField(input, "tool_name"),
        tool_input: field(input, "tool_input") ?? field(input, "toolInput"),
        tool_response: field(input, "tool_response") ?? field(input, "toolResponse"),
        tool_output: field(input, "tool_output") ?? field(input, "toolOutput"),
        tool_result: field(input, "tool_result") ?? field(input, "toolResult"),
        tool_use_id: stringField(input, "tool_use_id") ?? stringField(input, "toolUseId"),
        call_id: stringField(input, "call_id") ?? stringField(input, "callId"),
        duration_ms: numberField(input, "duration_ms") ?? numberField(input, "durationMs"),
        timestamp: stringField(input, "timestamp"),
    };
    const hookEventName = stringField(input, "hook_event_name") ?? portableEventName(event);
    if (event === "session-start") {
        const context = portableContext(await recall(common));
        writeHookOutput(hookEventName, context);
        return;
    }
    if (event === "before-agent") {
        const context = portableContext(await prompt(common));
        writeHookOutput(hookEventName, context);
        return;
    }
    if (event === "after-tool") {
        await observe(common);
        process.stdout.write("{}\n");
        return;
    }
    const response = stringField(input, "prompt_response") ?? stringField(input, "response");
    if (response) {
        await captureExternalTurn({
            sessionId: common.session_id?.trim() || common.cwd?.trim() || "portable-hook",
            cwd: common.cwd,
            role: "assistant",
            text: response,
            at: stringField(input, "timestamp"),
        });
    }
    process.stdout.write("{}\n");
}
function portableContext(context) {
    return context
        .replaceAll("mcp__pathmark__recall_memory", "recall_memory")
        .replaceAll("mcp__pathmark__chat", "chat")
        .replaceAll("mcp__pathmark__search_memory", "search_memory");
}
function writeHookOutput(hookEventName, context) {
    process.stdout.write(`${JSON.stringify({
        ...(context
            ? { hookSpecificOutput: { hookEventName, additionalContext: context } }
            : {}),
        suppressOutput: true,
    })}\n`);
}
async function readInput() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw)
        return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("Hook input must be a JSON object");
    return parsed;
}
function stringField(input, key) {
    return typeof input[key] === "string" ? input[key] : undefined;
}
function field(input, key) {
    return input[key];
}
function numberField(input, key) {
    const value = input[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function portableEventName(event) {
    if (event === "session-start")
        return "SessionStart";
    if (event === "before-agent")
        return "BeforeAgent";
    if (event === "after-tool")
        return "AfterTool";
    return "AfterAgent";
}
function isHookEvent(value) {
    return value === "session-start" || value === "before-agent" || value === "after-tool" || value === "after-agent";
}
//# sourceMappingURL=hook-cli.js.map