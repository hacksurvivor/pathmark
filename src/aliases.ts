import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";

// Capture tags a project by its folder name; `project-aliases.json` in the store directory maps folder names
// (worktrees, renamed checkouts) to the project name conclusions use, e.g. {"co-ode": "co-od"}.
export const ALIAS_FILE = "project-aliases.json";

// Cached per file version (mtime), so a long-running server picks up edits without a restart.
const cache = new Map<string, { mtimeMs: number; aliases: Record<string, string> }>();

export function projectAliases(storeDir: string = loadConfig().storeDir): Record<string, string> {
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(path.join(storeDir, ALIAS_FILE)).mtimeMs;
  } catch {
    mtimeMs = -1;
  }
  const cached = cache.get(storeDir);
  if (cached && cached.mtimeMs === mtimeMs) return cached.aliases;
  let aliases: Record<string, string> = {};
  try {
    const parsed = JSON.parse(readFileSync(path.join(storeDir, ALIAS_FILE), "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      aliases = Object.fromEntries(
        Object.entries(parsed)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
          .map(([from, to]) => [from.trim().toLowerCase(), to.trim().toLowerCase()]),
      );
    }
  } catch {
    // No alias file: folder names are the project names.
  }
  cache.set(storeDir, { mtimeMs, aliases });
  return aliases;
}

export function canonicalProject(name: string, storeDir?: string): string {
  const aliases = projectAliases(storeDir);
  return Object.hasOwn(aliases, name) ? aliases[name] : name;
}
