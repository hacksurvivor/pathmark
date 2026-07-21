import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { codexHooksPath } from "./paths.js";

const PATHMARK_VERBS = ["recall", "prompt", "observe", "writeback"];
const PATHMARK_PATTERN = new RegExp(
  `\\bpathmark\\b[\\s\\S]*\\bcodex\\b[\\s\\S]*\\b(?:${PATHMARK_VERBS.join("|")})\\b`,
);
const LEGACY_PATTERN = /(?:codex-legacy|legacy-memory-adapter|codex-memory-bridge)/i;

interface HookCommand {
  type?: string;
  command?: unknown;
  timeout?: number;
  statusMessage?: string;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookCommand[];
  [key: string]: unknown;
}

interface HooksFile {
  hooks: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export interface HookStatus {
  pathmark: boolean;
  legacy: boolean;
}

export async function installPathmarkHooks(
  options: { replaceLegacyHooks?: boolean; hooksPath?: string } = {},
): Promise<void> {
  const file = await readHooksFile(options.hooksPath);
  await backupHooksFile(options.hooksPath);
  const stripped = stripOwnedHooks(
    file,
    (command) => PATHMARK_PATTERN.test(command) || Boolean(options.replaceLegacyHooks && LEGACY_PATTERN.test(command)),
  );
  await writeHooksFile(addPathmarkHooks(stripped), options.hooksPath);
}

export async function uninstallPathmarkHooks(hooksPath?: string): Promise<void> {
  const file = await readHooksFile(hooksPath);
  await backupHooksFile(hooksPath);
  await writeHooksFile(stripOwnedHooks(file, (command) => PATHMARK_PATTERN.test(command)), hooksPath);
}

export async function hookStatus(hooksPath?: string): Promise<HookStatus> {
  const commands = hookCommands(await readHooksFile(hooksPath));
  return {
    pathmark: commands.some((command) => PATHMARK_PATTERN.test(command)),
    legacy: commands.some((command) => LEGACY_PATTERN.test(command)),
  };
}

function addPathmarkHooks(file: HooksFile): HooksFile {
  const next: HooksFile = { ...file, hooks: { ...file.hooks } };
  next.hooks.SessionStart = [
    ...(next.hooks.SessionStart ?? []),
    {
      matcher: "startup|resume|clear|compact",
      hooks: [{ type: "command", command: "pathmark codex recall", timeout: 30, statusMessage: "pathmark" }],
    },
  ];
  next.hooks.UserPromptSubmit = [
    ...(next.hooks.UserPromptSubmit ?? []),
    { hooks: [{ type: "command", command: "pathmark codex prompt", timeout: 20 }] },
  ];
  next.hooks.PostToolUse = [
    ...(next.hooks.PostToolUse ?? []),
    { matcher: "*", hooks: [{ type: "command", command: "pathmark codex observe", timeout: 10 }] },
  ];
  next.hooks.PostToolUseFailure = [
    ...(next.hooks.PostToolUseFailure ?? []),
    { matcher: "*", hooks: [{ type: "command", command: "pathmark codex observe", timeout: 10 }] },
  ];
  next.hooks.Stop = [
    ...(next.hooks.Stop ?? []),
    { hooks: [{ type: "command", command: "pathmark codex writeback", timeout: 30 }] },
  ];
  next.hooks.PreCompact = [
    ...(next.hooks.PreCompact ?? []),
    { matcher: "manual|auto", hooks: [{ type: "command", command: "pathmark codex writeback", timeout: 30 }] },
  ];
  return next;
}

function stripOwnedHooks(file: HooksFile, isOwned: (command: string) => boolean): HooksFile {
  const next: HooksFile = { ...file, hooks: {} };
  for (const [event, groups] of Object.entries(file.hooks)) {
    const keptGroups: HookGroup[] = [];
    for (const group of groups) {
      const hooks = Array.isArray(group.hooks) ? group.hooks : [];
      const keptHooks = hooks.filter((hook) => !isOwnedHook(hook, isOwned));
      if (keptHooks.length > 0 || hooks.length === 0) keptGroups.push({ ...group, hooks: keptHooks });
    }
    if (keptGroups.length > 0) next.hooks[event] = keptGroups;
  }
  return next;
}

function isOwnedHook(hook: HookCommand, isOwned: (command: string) => boolean): boolean {
  return typeof hook.command === "string" && isOwned(hook.command);
}

function hookCommands(file: HooksFile): string[] {
  return Object.values(file.hooks).flatMap((groups) =>
    groups.flatMap((group) => (group.hooks ?? []).flatMap((hook) => (typeof hook.command === "string" ? [hook.command] : []))),
  );
}

async function readHooksFile(hooksPath = codexHooksPath()): Promise<HooksFile> {
  try {
    const parsed = JSON.parse(await readFile(hooksPath, "utf8")) as Partial<HooksFile>;
    return {
      ...parsed,
      hooks: parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks) ? normalizeHooks(parsed.hooks) : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { hooks: {} };
    throw error;
  }
}

function normalizeHooks(rawHooks: object): Record<string, HookGroup[]> {
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(rawHooks)) {
    hooks[event] = Array.isArray(groups) ? (groups as HookGroup[]) : [];
  }
  return hooks;
}

async function writeHooksFile(file: HooksFile, hooksPath = codexHooksPath()): Promise<void> {
  await mkdir(path.dirname(hooksPath), { recursive: true });
  await writeFile(hooksPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

async function backupHooksFile(hooksPath = codexHooksPath()): Promise<void> {
  try {
    await copyFile(hooksPath, `${hooksPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path.dirname(hooksPath), { recursive: true });
  }
}
