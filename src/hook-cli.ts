import { open } from "node:fs/promises";
import { captureExternalTurn, observe, prompt, recall, type CodexHookInput } from "./codex/capture.js";

type HookEvent = "session-start" | "before-agent" | "after-tool" | "after-agent";

// Claude Code registers MCP tools as mcp__<server>__<tool>, so its context keeps the qualified names.
type HookClient = "portable" | "claude-code";

export async function runPortableHook(event: string | undefined, args: string[] = []): Promise<void> {
  if (!isHookEvent(event)) {
    throw new Error("Usage: pathmark hook <session-start|before-agent|after-tool|after-agent> [--client=claude-code]");
  }
  const client: HookClient = args.includes("--client=claude-code") ? "claude-code" : "portable";
  const hookContext = (context: string) => (client === "claude-code" ? context : portableContext(context));
  const input = await readInput();
  const common: CodexHookInput = {
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
    const context = hookContext(await recall(common));
    writeHookOutput(hookEventName, context);
    return;
  }
  if (event === "before-agent") {
    const context = hookContext(await prompt(common));
    writeHookOutput(hookEventName, context);
    return;
  }
  if (event === "after-tool") {
    await observe(common);
    process.stdout.write("{}\n");
    return;
  }

  // Claude Code's Stop hook may omit the reply text; fall back to the transcript it points at.
  const response =
    stringField(input, "prompt_response") ??
    stringField(input, "response") ??
    stringField(input, "last_assistant_message") ??
    (common.transcript_path ? await lastAssistantText(common.transcript_path) : undefined);
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

const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

// Reads only the tail of a Claude Code JSONL transcript and returns the text of the final
// assistant turn. Malformed or partial lines are skipped; any read failure yields undefined.
export async function lastAssistantText(transcriptPath: string): Promise<string | undefined> {
  let tail: string;
  try {
    const handle = await open(transcriptPath, "r");
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      tail = buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  const lines = tail.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const text = assistantLineText(lines[index]);
    if (text) return text;
  }
  return undefined;
}

function assistantLineText(line: string): string | undefined {
  if (!line.includes('"assistant"')) return undefined;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof entry !== "object" || entry === null) return undefined;
  const { type, isSidechain, message } = entry as { type?: unknown; isSidechain?: unknown; message?: unknown };
  if (type !== "assistant" || isSidechain === true || typeof message !== "object" || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || undefined;
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

function field(input: Record<string, unknown>, key: string): unknown {
  return input[key];
}

function numberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
