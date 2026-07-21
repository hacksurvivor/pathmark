import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { codexHooksPath } from "./paths.js";
const PATHMARK_VERBS = ["recall", "prompt", "observe", "writeback"];
const PATHMARK_PATTERN = new RegExp(`\\bpathmark\\b[\\s\\S]*\\bcodex\\b[\\s\\S]*\\b(?:${PATHMARK_VERBS.join("|")})\\b`);
const LEGACY_PATTERN = /(?:codex-legacy|legacy-memory-adapter|codex-memory-bridge)/i;
export async function installPathmarkHooks(options = {}) {
    const file = await readHooksFile(options.hooksPath);
    await backupHooksFile(options.hooksPath);
    const stripped = stripOwnedHooks(file, (command) => PATHMARK_PATTERN.test(command) || Boolean(options.replaceLegacyHooks && LEGACY_PATTERN.test(command)));
    await writeHooksFile(addPathmarkHooks(stripped), options.hooksPath);
}
export async function uninstallPathmarkHooks(hooksPath) {
    const file = await readHooksFile(hooksPath);
    await backupHooksFile(hooksPath);
    await writeHooksFile(stripOwnedHooks(file, (command) => PATHMARK_PATTERN.test(command)), hooksPath);
}
export async function hookStatus(hooksPath) {
    const commands = hookCommands(await readHooksFile(hooksPath));
    return {
        pathmark: commands.some((command) => PATHMARK_PATTERN.test(command)),
        legacy: commands.some((command) => LEGACY_PATTERN.test(command)),
    };
}
function addPathmarkHooks(file) {
    const next = { ...file, hooks: { ...file.hooks } };
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
function stripOwnedHooks(file, isOwned) {
    const next = { ...file, hooks: {} };
    for (const [event, groups] of Object.entries(file.hooks)) {
        const keptGroups = [];
        for (const group of groups) {
            const hooks = Array.isArray(group.hooks) ? group.hooks : [];
            const keptHooks = hooks.filter((hook) => !isOwnedHook(hook, isOwned));
            if (keptHooks.length > 0 || hooks.length === 0)
                keptGroups.push({ ...group, hooks: keptHooks });
        }
        if (keptGroups.length > 0)
            next.hooks[event] = keptGroups;
    }
    return next;
}
function isOwnedHook(hook, isOwned) {
    return typeof hook.command === "string" && isOwned(hook.command);
}
function hookCommands(file) {
    return Object.values(file.hooks).flatMap((groups) => groups.flatMap((group) => (group.hooks ?? []).flatMap((hook) => (typeof hook.command === "string" ? [hook.command] : []))));
}
async function readHooksFile(hooksPath = codexHooksPath()) {
    try {
        const parsed = JSON.parse(await readFile(hooksPath, "utf8"));
        return {
            ...parsed,
            hooks: parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks) ? normalizeHooks(parsed.hooks) : {},
        };
    }
    catch (error) {
        if (error.code === "ENOENT")
            return { hooks: {} };
        throw error;
    }
}
function normalizeHooks(rawHooks) {
    const hooks = {};
    for (const [event, groups] of Object.entries(rawHooks)) {
        hooks[event] = Array.isArray(groups) ? groups : [];
    }
    return hooks;
}
async function writeHooksFile(file, hooksPath = codexHooksPath()) {
    await mkdir(path.dirname(hooksPath), { recursive: true });
    await writeFile(hooksPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}
async function backupHooksFile(hooksPath = codexHooksPath()) {
    try {
        await copyFile(hooksPath, `${hooksPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
        await mkdir(path.dirname(hooksPath), { recursive: true });
    }
}
//# sourceMappingURL=hooks.js.map