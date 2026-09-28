import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeCodeAllowRules } from "./tool-policy.js";

export interface ApplyPermissionsResult {
  file: string;
  added: string[];
  alreadyPresent: string[];
  backupFile?: string;
}

export function claudeSettingsFile(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");
  return path.join(configDir, "settings.json");
}

// Merges only Pathmark's read-only allow rules into the user's Claude Code settings. Every other
// key is kept as-is; an unparseable file is left untouched rather than rewritten.
export async function applyClaudeCodePermissions(file = claudeSettingsFile()): Promise<ApplyPermissionsResult> {
  let raw: string | undefined;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let settings: Record<string, unknown> = {};
  if (raw?.trim()) {
    const parsed = (() => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new Error(`${file} is not valid JSON; fix it first. Pathmark did not change it.`);
      }
    })();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${file} is not a JSON object; Pathmark did not change it.`);
    }
    settings = parsed as Record<string, unknown>;
  }

  const permissions = objectField(settings, "permissions", file);
  const existing = permissions.allow ?? [];
  if (!Array.isArray(existing)) throw new Error(`${file}: permissions.allow is not an array; Pathmark did not change it.`);
  const rules = claudeCodeAllowRules();
  const added = rules.filter((rule) => !existing.includes(rule));
  const alreadyPresent = rules.filter((rule) => existing.includes(rule));
  if (added.length === 0) return { file, added, alreadyPresent };

  permissions.allow = [...existing, ...added];
  settings.permissions = permissions;

  await mkdir(path.dirname(file), { recursive: true });
  let backupFile: string | undefined;
  if (raw !== undefined) {
    backupFile = `${file}.pathmark-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(file, backupFile);
  }
  const indent = raw && /^\t/m.test(raw) ? "\t" : raw && /^ {4}"/m.test(raw) && !/^ {2}"/m.test(raw) ? 4 : 2;
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(settings, null, indent)}\n`, { mode: 0o600 });
  await rename(temp, file);
  return { file, added, alreadyPresent, ...(backupFile ? { backupFile } : {}) };
}

function objectField(settings: Record<string, unknown>, key: string, file: string): Record<string, unknown> {
  const value = settings[key];
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file}: ${key} is not an object; Pathmark did not change it.`);
  }
  return value as Record<string, unknown>;
}
