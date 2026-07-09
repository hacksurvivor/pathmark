import { createHash } from "node:crypto";
import path from "node:path";
import { loadConfig } from "../config.js";
import { deterministicId } from "../ids.js";
import { redactSecrets } from "../redact.js";
import { PathmarkStore } from "../store.js";
import type { PathmarkRecordDraft, SearchResult } from "../types.js";
import { readCursorState, writeCursor } from "./cursor.js";
import { summarizeToolUse } from "./tool-summary.js";
import { readCodexTranscriptStrict } from "./transcript.js";

export interface CodexHookInput {
  cwd?: string;
  session_id?: string;
  prompt?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: unknown;
}

const TRIVIAL_PROMPT = /^(?:y|n|yes|no|ok|okay|sure|thanks|yep|nope|continue|go ahead|do it|proceed)\.?$/i;
const MEMORY_CUE =
  /\b(?:before|previous|previously|earlier|last time|remember|memory|context|history|decided|decision|same as|again|preference|prefer|repo|project)\b/i;
const GENERIC_RECALL_TOKENS = new Set(["codex", "coding", "users", "user", "mac", "home", "documents"]);
const GENERIC_RECALL_TERMS = ["project", "decisions", "preferences"];
const RECALL_TEXT_LIMIT = 240;
const RECALL_SEARCH_LIMIT = 50;
const PROMPT_RECALL_LIMIT = 5;
const IMMEDIATE_PROMPT_TAG = "immediate-prompt";
const IMMEDIATE_PROMPT_WINDOW_MS = 5 * 60 * 1000;
const TRIVIAL_ASSISTANT_TURN = /^(?:done|ok|fixed|complete|completed)[.!?]*$/i;

export async function recall(input: CodexHookInput): Promise<string> {
  const config = loadConfig();
  const store = new PathmarkStore(config);
  const query = recallQuery(input);
  if (!query) return memoryBlock([], config.memoryFile);

  try {
    const results = await recallSearchResults(store, query, input);
    return memoryBlock(filterRecallResults(results, input).slice(0, 8), config.memoryFile);
  } catch {
    return memoryBlock([], config.memoryFile);
  }
}

export async function prompt(input: CodexHookInput): Promise<string> {
  const text = input.prompt?.trim() ?? "";
  if (shouldSkipUserPrompt(text)) return "";
  const config = loadConfig();
  const store = new PathmarkStore(config);

  try {
    const context = config.codexProactiveRecall
      ? await proactivePromptContext(store, input, text, {
          memoryFile: config.memoryFile,
          visibleRecall: config.codexVisibleRecall,
        })
      : "";
    await store.addRecord(capturedRecord({
      sessionId: sessionId(input),
      cwd: input.cwd,
      role: "user",
      text,
      at: new Date().toISOString(),
      immediatePrompt: true,
    }));
    if (context) return context;
  } catch (error) {
    return hookWarning("capture the prompt", error);
  }

  if (!MEMORY_CUE.test(text)) return "";
  return [
    "<pathmark-memory-nudge>",
    "This prompt may depend on Pathmark memory. Prefer mcp__pathmark__recall_memory or mcp__pathmark__chat when the user wants visible memory entries; use mcp__pathmark__search_memory for exact records.",
    "</pathmark-memory-nudge>",
  ].join("\n");
}

async function proactivePromptContext(
  store: PathmarkStore,
  input: CodexHookInput,
  promptText: string,
  options: { memoryFile: string; visibleRecall: boolean },
): Promise<string> {
  const query = promptRecallQuery(input, promptText);
  if (!query) return "";

  const tagFilters = promptRecallTagFilters(input);
  const searches = tagFilters.map((tags) => store.search({ query, tags, limit: RECALL_SEARCH_LIMIT }));
  const results = await Promise.all(searches.length > 0 ? searches : [store.search({ query, limit: RECALL_SEARCH_LIMIT })]);
  const merged = new Map<string, SearchResult>();

  for (const resultSet of results) {
    for (const result of resultSet) {
      if (isCurrentImmediatePrompt(result, input, promptText)) continue;
      const existing = merged.get(result.record.id);
      if (!existing || result.score > existing.score) merged.set(result.record.id, result);
    }
  }

  const filtered = filterRecallResults([...merged.values()], input)
    .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt))
    .slice(0, PROMPT_RECALL_LIMIT);
  if (filtered.length === 0) return "";
  return memoryBlock(filtered, options.memoryFile, {
    visibleRecall: options.visibleRecall ? { query, tags: primaryPromptRecallTags(input), limit: PROMPT_RECALL_LIMIT } : undefined,
  });
}

export async function observe(input: CodexHookInput): Promise<string> {
  const summary = summarizeToolUse({ tool_name: input.tool_name, tool_input: input.tool_input });
  if (!summary) return "";

  try {
    await saveCapturedRecord({
      sessionId: sessionId(input),
      cwd: input.cwd,
      role: "tool",
      text: summary,
      at: new Date().toISOString(),
    });
  } catch (error) {
    return hookWarning("capture tool use", error);
  }

  return "";
}

export async function writeback(input: CodexHookInput): Promise<string> {
  if (!input.transcript_path) return "";

  try {
    const config = loadConfig();
    const store = new PathmarkStore(config);
    const session = sessionId(input);
    const turns = await readCodexTranscriptStrict(input.transcript_path);
    const cursor = await readCursorState(config.storeDir, session);
    const legacyCursorUnknown = cursor.count > 0 && !cursor.transcriptFingerprint;
    const replacedTranscript = transcriptReplaced(cursor, turns);
    const rotatedTranscript = cursor.count > turns.length || replacedTranscript || legacyCursorUnknown;
    const rotationDiscriminator = rotatedTranscript && !legacyCursorUnknown ? transcriptRotationDiscriminator(turns) : undefined;
    const freshTurns = turns.slice(rotatedTranscript ? 0 : cursor.count);
    const immediatePrompts = await immediatePromptRecords(store, session);

    const records: PathmarkRecordDraft[] = [];
    for (const turn of freshTurns) {
      if (turn.role === "user" && shouldSkipUserPrompt(turn.text)) continue;
      if (turn.role === "user" && consumeImmediatePrompt(immediatePrompts, turn.text, turn.at)) continue;
      if (turn.role === "assistant" && shouldSkipAssistantTurn(turn.text)) continue;
      records.push(
        capturedRecord({
          sessionId: session,
          cwd: input.cwd,
          role: turn.role,
          text: turn.text,
          at: turn.at ?? new Date().toISOString(),
          stablePart: rotationDiscriminator ? `rotation:${rotationDiscriminator}:${turn.index}` : String(turn.index),
        }),
      );
    }

    await store.addRecords(records);
    await writeCursor(config.storeDir, session, turns.length, {
      transcriptFingerprint: transcriptFingerprint(turns),
    });
  } catch (error) {
    return hookWarning("write transcript memory", error);
  }

  return "";
}

function transcriptReplaced(
  cursor: { count: number; transcriptFingerprint?: string },
  turns: { role: string; index: number; at?: string; text: string }[],
): boolean {
  if (cursor.count <= 0 || cursor.count > turns.length || !cursor.transcriptFingerprint) return false;
  return cursor.transcriptFingerprint !== transcriptFingerprint(turns.slice(0, cursor.count));
}

function transcriptFingerprint(turns: { role: string; index: number; at?: string; text: string }[]): string {
  return hashTurns(turns);
}

function transcriptRotationDiscriminator(turns: { role: string; index: number; at?: string; text: string }[]): string {
  return hashTurns(turns);
}

function hashTurns(turns: { role: string; index: number; at?: string; text: string }[]): string {
  const hash = createHash("sha256");
  for (const turn of turns) {
    hash.update(turn.role);
    hash.update("\0");
    hash.update(String(turn.index));
    hash.update("\0");
    hash.update(turn.at ?? "");
    hash.update("\0");
    hash.update(normalizeCapturedText(turn.text));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

async function saveCapturedRecord(input: {
  sessionId: string;
  cwd?: string;
  role: "user" | "assistant" | "tool";
  text: string;
  at: string;
  stablePart?: string;
  immediatePrompt?: boolean;
}): Promise<void> {
  const config = loadConfig();
  const store = new PathmarkStore(config);
  await store.addRecord(capturedRecord(input));
}

function capturedRecord(input: {
  sessionId: string;
  cwd?: string;
  role: "user" | "assistant" | "tool";
  text: string;
  at: string;
  stablePart?: string;
  immediatePrompt?: boolean;
}): PathmarkRecordDraft {
  const redacted = redactSecrets(input.text);
  const roleTag = `role-${input.role}`;
  const tags = ["codex-raw", "codex-session", roleTag, `session:${input.sessionId}`];
  const projectTag = projectTagFromCwd(input.cwd);
  if (projectTag) tags.push(projectTag);
  const workspaceTag = workspaceTagFromCwd(input.cwd);
  if (workspaceTag) tags.push(workspaceTag);
  if (input.immediatePrompt) tags.push(IMMEDIATE_PROMPT_TAG);
  if (redacted.redacted || redacted.text.includes("[REDACTED]")) tags.push("redacted");
  const normalizedText = normalizeCapturedText(redacted.text);
  const stablePart = input.stablePart ?? input.at;

  return {
    id: deterministicId(["codex", input.sessionId, input.role, stablePart, normalizedText]),
    kind: "memory",
    text: redacted.text,
    tags,
    source: `codex:session:${input.sessionId}`,
    createdAt: input.at,
    updatedAt: input.at,
  };
}

function memoryBlock(
  results: SearchResult[],
  memoryFile: string,
  options: { visibleRecall?: { query: string; tags: string[]; limit: number } } = {},
): string {
  return [
    "<pathmark-memory>",
    "Pathmark memory context:",
    results.length > 0 ? `Used memories:\n${summarizeResults(results)}` : "No matching Pathmark memory found.",
    options.visibleRecall && results.length > 0 ? visibleRecallInstruction(options.visibleRecall) : "",
    "",
    `Store: ${memoryFile}`,
    "MCP tools: use mcp__pathmark__recall_memory or mcp__pathmark__chat for visible memory entries; use mcp__pathmark__search_memory for exact records.",
    "</pathmark-memory>",
  ].join("\n");
}

function visibleRecallInstruction(input: { query: string; tags: string[]; limit: number }): string {
  const args: { query: string; limit: number; tags?: string[] } = {
    query: input.query,
    limit: input.limit,
  };
  if (input.tags.length > 0) args.tags = input.tags;
  return [
    "",
    "Visible recall request:",
    `Before answering, call mcp__pathmark__recall_memory with ${JSON.stringify(args)} so the UI shows the exact usedMemories behind this context.`,
  ].join("\n");
}

function hookWarning(action: string, error: unknown): string {
  return [
    "<pathmark-memory-warning>",
    `Pathmark could not ${action}: ${errorSummary(error)}`,
    "</pathmark-memory-warning>",
  ].join("\n");
}

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncate(message.replace(/\s+/g, " ").trim() || "unknown error", 240);
}

function summarizeResults(results: SearchResult[]): string {
  return results
    .map((result, index) => {
      const record = result.record;
      const redacted = redactSecrets(record.text);
      const matches = result.matchedTerms.length > 0 ? ` matched=${result.matchedTerms.join(",")}` : "";
      return [
        `${index + 1}. ${record.kind} ${record.id}`,
        `   createdAt: ${record.createdAt}`,
        `   source: ${record.source}${matches}`,
        `   preview: ${truncate(redacted.text, RECALL_TEXT_LIMIT)}`,
      ].join("\n");
    })
    .join("\n");
}

function recallQuery(input: CodexHookInput): string {
  const specificTerms = recallSpecificTerms(input);
  if (specificTerms.length === 0) return "";
  return [...new Set([...specificTerms, ...GENERIC_RECALL_TERMS])].join(" ");
}

async function recallSearchResults(
  store: PathmarkStore,
  query: string,
  input: CodexHookInput,
): Promise<SearchResult[]> {
  const specificQuery = recallSpecificTerms(input).join(" ");
  const searches = [store.search({ query, limit: RECALL_SEARCH_LIMIT })];
  if (specificQuery && specificQuery !== query) {
    searches.push(store.search({ query: specificQuery, limit: RECALL_SEARCH_LIMIT }));
  }

  const merged = new Map<string, SearchResult>();
  for (const results of await Promise.all(searches)) {
    for (const result of results) {
      const existing = merged.get(result.record.id);
      if (!existing || result.score > existing.score) merged.set(result.record.id, result);
    }
  }

  return [...merged.values()].sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt));
}

function filterRecallResults(results: SearchResult[], input: CodexHookInput): SearchResult[] {
  const specificTerms = recallSpecificTerms(input);
  const session = input.session_id?.trim().toLowerCase();
  const workspaceTag = workspaceTagFromCwd(input.cwd);
  if (specificTerms.length === 0 && !session) return results;

  return results.filter((result) => {
    const record = result.record;
    const tags = record.tags.map((tag) => tag.toLowerCase());
    const source = record.source.toLowerCase();
    if (session && (source === `codex:session:${session}` || tags.includes(`session:${session}`))) return true;
    if (workspaceTag && tags.some((tag) => tag.startsWith("workspace:"))) return tags.includes(workspaceTag);
    if (workspaceTag) return false;

    const haystack = `${record.text} ${record.tags.join(" ")} ${record.source}`.toLowerCase();
    return specificTerms.some((term) => haystack.includes(term.toLowerCase()));
  });
}

function recallSpecificTerms(input: CodexHookInput): string[] {
  const cwdTerms = recallTermsFromCwd(input.cwd);
  const workspaceTag = workspaceTagFromCwd(input.cwd);
  const session = input.session_id?.trim();
  const sessionTerms = session && !GENERIC_RECALL_TOKENS.has(session.toLowerCase()) ? [session] : [];
  return [...new Set([...(workspaceTag ? [workspaceTag] : []), ...cwdTerms, ...sessionTerms])];
}

function promptRecallQuery(input: CodexHookInput, promptText: string): string {
  const promptTerms = redactSecrets(promptText).text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !GENERIC_RECALL_TOKENS.has(term));
  const cwdTerms = recallTermsFromCwd(input.cwd);
  const session = input.session_id?.trim();
  const sessionTerms = session && !GENERIC_RECALL_TOKENS.has(session.toLowerCase()) ? [session] : [];
  return [...new Set([...promptTerms, ...cwdTerms, ...sessionTerms, ...GENERIC_RECALL_TERMS])].join(" ");
}

function promptRecallTagFilters(input: CodexHookInput): string[][] {
  const filters: string[][] = [];
  const workspaceTag = workspaceTagFromCwd(input.cwd);
  if (workspaceTag) filters.push([workspaceTag]);
  const session = input.session_id?.trim();
  if (session) filters.push([`session:${session}`]);
  return filters;
}

function primaryPromptRecallTags(input: CodexHookInput): string[] {
  const workspaceTag = workspaceTagFromCwd(input.cwd);
  if (workspaceTag) return [workspaceTag];
  const session = input.session_id?.trim();
  return session ? [`session:${session}`] : [];
}

function isCurrentImmediatePrompt(result: SearchResult, input: CodexHookInput, promptText: string): boolean {
  const record = result.record;
  if (!record.tags.includes(IMMEDIATE_PROMPT_TAG)) return false;
  if (record.source.toLowerCase() !== `codex:session:${sessionId(input).toLowerCase()}`) return false;
  return normalizeCapturedText(record.text) === normalizeCapturedText(redactSecrets(promptText).text);
}

function recallTermsFromCwd(cwd: string | undefined): string[] {
  if (!cwd?.trim()) return [];
  const basename = path.basename(cwd.trim());
  return basename
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !GENERIC_RECALL_TOKENS.has(term));
}

function projectTagFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd?.trim()) return undefined;
  const project = path
    .basename(cwd.trim())
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!project || GENERIC_RECALL_TOKENS.has(project)) return undefined;
  return `project:${project}`;
}

function workspaceTagFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd?.trim()) return undefined;
  const normalized = path.resolve(cwd.trim());
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `workspace:${hash}`;
}

function sessionId(input: CodexHookInput): string {
  return input.session_id?.trim() || input.cwd?.trim() || "codex";
}

function shouldSkipUserPrompt(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || TRIVIAL_PROMPT.test(trimmed);
}

function shouldSkipAssistantTurn(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || TRIVIAL_ASSISTANT_TURN.test(trimmed);
}

async function immediatePromptRecords(store: PathmarkStore, session: string): Promise<Map<string, number[]>> {
  const records = new Map<string, number[]>();
  const sessionTag = `session:${session}`.toLowerCase();

  for (const record of await store.all()) {
    if (!record.tags.includes("role-user")) continue;
    if (!record.tags.includes(IMMEDIATE_PROMPT_TAG)) continue;
    if (record.source.toLowerCase() !== `codex:session:${session.toLowerCase()}` && !record.tags.includes(sessionTag)) {
      continue;
    }

    const createdAt = Date.parse(record.createdAt);
    if (!Number.isFinite(createdAt)) continue;

    const key = normalizeCapturedText(record.text);
    records.set(key, [...(records.get(key) ?? []), createdAt]);
  }

  return records;
}

function consumeImmediatePrompt(records: Map<string, number[]>, text: string, turnAt: string | undefined): boolean {
  if (!turnAt) return false;
  const turnTime = Date.parse(turnAt);
  if (!Number.isFinite(turnTime)) return false;

  const redacted = redactSecrets(text);
  const key = normalizeCapturedText(redacted.text);
  const candidates = records.get(key) ?? [];
  const index = candidates.findIndex((createdAt) => Math.abs(createdAt - turnTime) <= IMMEDIATE_PROMPT_WINDOW_MS);
  if (index < 0) return false;

  candidates.splice(index, 1);
  if (candidates.length === 0) records.delete(key);
  else records.set(key, candidates);
  return true;
}

function normalizeCapturedText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function truncate(text: string, limit: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}
