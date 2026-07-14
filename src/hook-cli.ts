import { captureExternalTurn, observe, prompt, recall, type CodexHookInput } from "./codex/capture.js";

type HookEvent = "session-start" | "before-agent" | "after-tool" | "after-agent";

export async function runPortableHook(event: string | undefined): Promise<void> {
  if (!isHookEvent(event)) throw new Error("Usage: pathmark hook <session-start|before-agent|after-tool|after-agent>");
  const input = await readInput();
  const common: CodexHookInput = {
    session_id: stringField(input, "session_id") ?? stringField(input, "sessionId"),
    cwd: stringField(input, "cwd"),
    transcript_path: stringField(input, "transcript_path"),
    prompt: stringField(input, "prompt"),
    tool_name: stringField(input, "tool_name"),
    tool_input: objectField(input, "tool_input"),
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

function portableContext(context: string): string {
  return context
    .replaceAll("mcp__pathmark__recall_memory", "recall_memory")
    .replaceAll("mcp__pathmark__chat", "chat")
    .replaceAll("mcp__pathmark__search_memory", "search_memory");
}

function writeHookOutput(hookEventName: string, context: string): void {
  process.stdout.write(
    `${JSON.stringify({
      ...(context
        ? { hookSpecificOutput: { hookEventName, additionalContext: context } }
        : {}),
      suppressOutput: true,
    })}\n`,
  );
}

async function readInput(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Hook input must be a JSON object");
  return parsed as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? input[key] : undefined;
}

function objectField(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function portableEventName(event: HookEvent): string {
  if (event === "session-start") return "SessionStart";
  if (event === "before-agent") return "BeforeAgent";
  if (event === "after-tool") return "AfterTool";
  return "AfterAgent";
}

function isHookEvent(value: string | undefined): value is HookEvent {
  return value === "session-start" || value === "before-agent" || value === "after-tool" || value === "after-agent";
}
