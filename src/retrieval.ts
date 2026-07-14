import { spawn } from "node:child_process";
import type { SearchResult } from "./types.js";

export async function rerankWithCommand(input: {
  command: string;
  query: string;
  candidates: SearchResult[];
  timeoutMs: number;
}): Promise<SearchResult[]> {
  if (input.candidates.length === 0) return [];
  const payload = JSON.stringify({
    query: input.query,
    candidates: input.candidates.map((candidate) => ({
      id: candidate.record.id,
      kind: candidate.record.kind,
      text: candidate.record.text,
      tags: candidate.record.tags,
      createdAt: candidate.record.createdAt,
      updatedAt: candidate.record.updatedAt,
    })),
  });
  const stdout = await runShellCommand(input.command, payload, input.timeoutMs);
  const parsed = JSON.parse(stdout) as unknown;
  const ids = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { ids?: unknown }).ids)
      ? (parsed as { ids: unknown[] }).ids
      : undefined;
  if (!ids || !ids.every((id) => typeof id === "string")) {
    throw new Error("PATHMARK_RERANK_COMMAND must return a JSON array of memory ids or {\"ids\":[...]} ");
  }
  const byId = new Map(input.candidates.map((candidate) => [candidate.record.id, candidate]));
  const ranked: SearchResult[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const candidate = byId.get(id as string);
    if (!candidate || seen.has(candidate.record.id)) continue;
    seen.add(candidate.record.id);
    ranked.push({ ...candidate, retrieval: "hybrid" });
  }
  for (const candidate of input.candidates) {
    if (!seen.has(candidate.record.id)) ranked.push({ ...candidate, retrieval: "hybrid" });
  }
  return ranked;
}

function runShellCommand(command: string, stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { stdio: ["pipe", "pipe", "pipe"], env: process.env, shell: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Retrieval command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8").trim());
      else reject(new Error(`PATHMARK_RERANK_COMMAND exited with ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end(stdin);
  });
}
