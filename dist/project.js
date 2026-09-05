import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
export function workspaceTag(cwd) {
    return `workspace:${createHash("sha256").update(path.resolve(cwd.trim())).digest("hex").slice(0, 12)}`;
}
export function projectScope(cwd) {
    let root = path.resolve(cwd);
    try {
        root = realpathSync(root);
    }
    catch { /* A host may report an unavailable directory. */ }
    let identityRoot = root;
    let gitProject = false;
    try {
        const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
            cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1_000,
        }).trim();
        identityRoot = realpathSync(common);
        gitProject = true;
        if (path.basename(common) === ".git")
            root = path.dirname(common);
    }
    catch { /* Non-Git projects retain a directory identity. */ }
    let ancestor = root;
    while (!gitProject && !existsSync(path.join(ancestor, "pathmark.project.json")) && path.dirname(ancestor) !== ancestor)
        ancestor = path.dirname(ancestor);
    if (existsSync(path.join(ancestor, "pathmark.project.json")))
        root = ancestor;
    const configFile = path.join(root, "pathmark.project.json");
    let configured;
    if (existsSync(configFile)) {
        const parsed = JSON.parse(readFileSync(configFile, "utf8"));
        if (typeof parsed.id !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(parsed.id))
            throw new Error("Invalid pathmark.project.json id");
        configured = parsed.id.toLowerCase();
    }
    const id = configured ?? createHash("sha256").update(identityRoot).digest("hex").slice(0, 24);
    return { id, root, tags: [...new Set([`project-id:${id}`, workspaceTag(cwd), workspaceTag(root)])] };
}
export function initializeProject(cwd, id) {
    const scope = projectScope(cwd);
    const selected = id ?? randomUUID();
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(selected))
        throw new Error("Project id must contain 8-100 letters, digits, underscores or hyphens");
    const file = path.join(scope.root, "pathmark.project.json");
    if (existsSync(file)) {
        if (id && scope.id !== id.toLowerCase())
            throw new Error("Project already has a different identity; review the mapping before editing its file");
        return scope;
    }
    writeFileSync(file, JSON.stringify({ version: 1, id: selected.toLowerCase() }, null, 2) + "\n", { flag: "wx" });
    return projectScope(cwd);
}
//# sourceMappingURL=project.js.map