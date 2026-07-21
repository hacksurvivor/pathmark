import { createHash } from "node:crypto";
import { redactSecrets } from "../redact.js";
import type { PathmarkToolActivity } from "../types.js";
import { summarizeToolUse, toolChangedFiles, toolShellCommand } from "./tool-summary.js";

export interface ToolActivityInput {
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  tool_output?: unknown;
  tool_result?: unknown;
  tool_use_id?: string;
  call_id?: string;
  duration_ms?: number;
}

export interface CapturedToolActivity {
  summary: string;
  activity: PathmarkToolActivity;
  redacted: boolean;
}

const COMMAND_LIMIT = 2_000;
const INPUT_LIMIT = 1_000;
const OUTPUT_LIMIT = 2_000;

export function captureToolActivity(
  input: ToolActivityInput,
  options: { includeOutputPreview?: boolean } = {},
): CapturedToolActivity | undefined {
  const summary = summarizeToolUse(input);
  if (!summary) return undefined;

  const toolName = input.tool_name?.trim() ?? "unknown";
  const response = firstDefined(input.tool_response, input.tool_output, input.tool_result);
  const command = toolShellCommand(input.tool_input).trim();
  const changedFiles = toolChangedFiles(toolName, input.tool_input).slice(0, 50);
  const output = responseText(response);
  const exitCode = firstFinite(
    numericField(response, ["exit_code", "exitCode", "code"]),
    command ? shellExitCode(output) : undefined,
  );
  const durationMs = firstFinite(
    input.duration_ms,
    numericField(response, ["duration_ms", "durationMs"]),
    secondsToMs(numericField(response, ["wall_time_seconds", "wallTimeSeconds"])),
    command ? shellDurationMs(output) : undefined,
  );
  const isError = booleanField(response, ["isError", "is_error"]);
  const hasError = isRecord(response) && response.error !== undefined && response.error !== false && response.error !== null;
  const status = exitCode !== undefined
    ? exitCode === 0 ? "success" : "error"
    : isError === true || hasError ? "error"
    : response === undefined ? "unknown" : "success";

  let redacted = false;
  const safe = (value: string, limit: number): { preview: string; hash: string } | undefined => {
    const normalized = value.trim();
    if (!normalized) return undefined;
    const result = redactSecrets(normalized);
    redacted ||= result.redacted || result.text.includes("[REDACTED]");
    return { preview: truncate(result.text, limit), hash: digest(result.text) };
  };

  const safeCommand = command ? safe(command, COMMAND_LIMIT) : undefined;
  const safeInput = command ? undefined : safe(stableStringify(input.tool_input), INPUT_LIMIT);
  const safeOutput = safe(output, OUTPUT_LIMIT);
  const filesChanged = changedFiles.length > 0
    ? true
    : toolName === "apply_patch" || toolName === "functions.apply_patch"
      ? false
      : "unknown";

  return {
    summary,
    redacted,
    activity: {
      type: "tool",
      toolName,
      ...(input.tool_use_id || input.call_id ? { callId: input.tool_use_id ?? input.call_id } : {}),
      status,
      ...(safeCommand ? { commandPreview: safeCommand.preview, commandHash: safeCommand.hash } : {}),
      ...(safeInput ? { inputPreview: safeInput.preview, inputHash: safeInput.hash } : {}),
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(durationMs)) }),
      ...(safeOutput
        ? { ...(options.includeOutputPreview ? { outputPreview: safeOutput.preview } : {}), outputHash: safeOutput.hash }
        : {}),
      filesChanged,
      ...(changedFiles.length > 0 ? { changedFiles } : {}),
    },
  };
}

export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function responseText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(responseText).filter(Boolean).join("\n");
  if (!isRecord(value)) return value === undefined || value === null ? "" : String(value);

  if (value.output === undefined && (value.stdout !== undefined || value.stderr !== undefined)) {
    return [
      value.stdout === undefined ? "" : responseText(value.stdout),
      value.stderr === undefined ? "" : responseText(value.stderr),
    ].filter(Boolean).join("\n");
  }

  for (const key of ["output", "stdout", "stderr", "result", "content", "text", "message", "error"]) {
    if (value[key] !== undefined) {
      const text = responseText(value[key]);
      if (text) return text;
    }
  }
  return stableStringify(value);
}

function numericField(value: unknown, keys: string[]): number | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "number" && Number.isFinite(field)) return field;
  }
  return undefined;
}

function booleanField(value: unknown, keys: string[]): boolean | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) if (typeof value[key] === "boolean") return value[key];
  return undefined;
}

function secondsToMs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value * 1_000;
}

function shellExitCode(output: string): number | undefined {
  const explicit = output.match(/(?:process\s+)?exit(?:ed)?(?:\s+with)?(?:\s+code)?[:\s]+(-?\d+)/i);
  if (explicit) return Number.parseInt(explicit[1], 10);
  if (/\bscript completed\b/i.test(output)) return 0;
  return undefined;
}

function shellDurationMs(output: string): number | undefined {
  const match = output.match(/\bwall time[:\s]+(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|s)\b/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  return /^m/i.test(match[2]) ? value : value * 1_000;
}

function firstFinite(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => typeof value === "number" && Number.isFinite(value));
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, Object.keys(isRecord(value) ? value : {}).sort());
  } catch {
    return String(value);
  }
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
