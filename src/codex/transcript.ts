import { readFile } from "node:fs/promises";

export interface CodexTurn {
  role: "user" | "assistant";
  text: string;
  at?: string;
  index: number;
}

export interface CodexToolResult {
  callId: string;
  output: string;
  at?: string;
  status: "success" | "error" | "unknown";
  exitCode?: number;
  durationMs?: number;
}

const TEXT_BLOCK_TYPES = new Set(["input_text", "output_text", "text"]);
const INJECTED_TAGS = [
  "environment_context",
  "turn_aborted",
  "user_instructions",
  "apps_instructions",
  "plugins_instructions",
  "skills_instructions",
  "collaboration_mode",
  "codex_internal_context",
  "pathmark-memory",
  "pathmark-memory-nudge",
  "recommended_plugins",
  "subagent_notification",
];

export async function readCodexTranscript(file: string): Promise<CodexTurn[]> {
  return readCodexTranscriptFile(file, { strict: false });
}

export async function readCodexTranscriptStrict(file: string): Promise<CodexTurn[]> {
  return readCodexTranscriptFile(file, { strict: true });
}

export async function readCodexToolResults(file: string): Promise<CodexToolResult[]> {
  const raw = await readFile(file, "utf8");
  const results: CodexToolResult[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = parseToolResultEvent(event);
    if (parsed) results.push(parsed);
  }
  return results;
}

export async function readCodexLegacyNoiseTurns(file: string): Promise<CodexTurn[]> {
  const raw = await readFile(file, "utf8");
  const turns: CodexTurn[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || event.type !== "response_item") continue;
    const payload = event.payload;
    if (!isRecord(payload) || payload.type !== "message") continue;
    const role = payload.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = collectText(payload.content).trim();
    if (!text) continue;
    const legacyNoise = role === "assistant"
      ? payload.phase === "commentary"
      : isInjectedContext(text) || isCodexUserTransport(text);
    if (!legacyNoise) continue;
    turns.push({
      role,
      text,
      at: typeof event.timestamp === "string" ? event.timestamp : undefined,
      index: turns.length,
    });
  }
  return turns;
}

async function readCodexTranscriptFile(file: string, options: { strict: boolean }): Promise<CodexTurn[]> {
  const raw = await readFile(file, "utf8");
  const turns: CodexTurn[] = [];
  let lineNumber = 0;

  for (const line of raw.split("\n")) {
    lineNumber += 1;
    if (!line.trim()) continue;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      if (options.strict) throw new Error(`Invalid Codex transcript JSON at line ${lineNumber}: ${file}`);
      continue;
    }

    const parsed = parseTranscriptEventInternal(event, turns.length, options.strict ? { file, lineNumber } : undefined);
    if (parsed) turns.push(parsed);
  }

  return turns;
}

export function parseTranscriptEvent(event: unknown, index: number): CodexTurn | undefined {
  return parseTranscriptEventInternal(event, index);
}

function parseToolResultEvent(event: unknown): CodexToolResult | undefined {
  if (!isRecord(event) || event.type !== "response_item") return undefined;
  const payload = event.payload;
  if (!isRecord(payload) || payload.type !== "custom_tool_call_output" || typeof payload.call_id !== "string") {
    return undefined;
  }
  const output = collectText(payload.output).trim();
  if (!output) return undefined;
  const explicitExit = output.match(/(?:process\s+)?exit(?:ed)?(?:\s+with)?(?:\s+code)?[:\s]+(-?\d+)/i);
  const exitCode = explicitExit
    ? Number.parseInt(explicitExit[1], 10)
    : /\bscript completed\b/i.test(output)
      ? 0
      : undefined;
  const durationMatch = output.match(/\bwall time[:\s]+(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|s)\b/i);
  const durationMs = durationMatch
    ? Number.parseFloat(durationMatch[1]) * (/^m/i.test(durationMatch[2]) ? 1 : 1_000)
    : undefined;
  return {
    callId: payload.call_id,
    output,
    at: typeof event.timestamp === "string" ? event.timestamp : undefined,
    status: exitCode === undefined ? "unknown" : exitCode === 0 ? "success" : "error",
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(durationMs)) }),
  };
}

function parseTranscriptEventInternal(
  event: unknown,
  index: number,
  strict?: { file: string; lineNumber: number },
): CodexTurn | undefined {
  if (!isRecord(event) || event.type !== "response_item") return undefined;

  const payload = event.payload;
  if (!isRecord(payload) || payload.type !== "message") return undefined;
  if (payload.role !== "user" && payload.role !== "assistant") return undefined;
  if (payload.role === "assistant" && typeof payload.phase === "string" && payload.phase !== "final_answer") {
    return undefined;
  }

  let text = collectText(payload.content).trim();
  if (!text) {
    if (strict) throw new Error(`Malformed Codex transcript message at line ${strict.lineNumber}: ${strict.file}`);
    return undefined;
  }
  if (payload.role === "user") {
    text = normalizeCodexUserMessage(text);
    if (!text) return undefined;
  }

  return {
    role: payload.role,
    text,
    at: typeof event.timestamp === "string" ? event.timestamp : undefined,
    index,
  };
}

export function normalizeCodexUserMessage(text: string): string {
  const trimmed = text.trim();
  if (startsWithTag(trimmed, "realtime_delegation")) return unwrapRealtimeDelegation(trimmed);
  if (!trimmed || isInjectedContext(trimmed)) return "";
  return unwrapCodexUserTransport(trimmed);
}

function unwrapRealtimeDelegation(text: string): string {
  const match = text.match(/<input(?:\s[^>]*)?>([\s\S]*?)<\/input>/i);
  return match?.[1]?.trim() ?? "";
}

function unwrapCodexUserTransport(text: string): string {
  if (!isCodexUserTransport(text)) return text;
  const marker = /^##\s*My request for Codex:\s*$/im;
  const match = marker.exec(text);
  return match ? text.slice(match.index + match[0].length).trim() : "";
}

function isCodexUserTransport(text: string): boolean {
  return /^#\s*(?:files mentioned by the user|response annotations|diff comments):/i.test(text.trimStart());
}

function collectText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((block) => {
      if (typeof block === "string") return [block];
      if (!isRecord(block) || !TEXT_BLOCK_TYPES.has(String(block.type))) return [];
      return typeof block.text === "string" ? [block.text] : [];
    })
    .join("\n");
}

function isInjectedContext(text: string): boolean {
  const trimmed = text.trimStart();
  if (/^<[a-z0-9-]+-memory(?:-nudge)?(?:\s|>)/i.test(trimmed)) return true;
  return INJECTED_TAGS.some((tag) => startsWithTag(trimmed, tag));
}

function startsWithTag(text: string, tag: string): boolean {
  if (!text.startsWith(`<${tag}`)) return false;
  const next = text.at(tag.length + 1);
  return next === ">" || next === undefined || /\s/.test(next);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
