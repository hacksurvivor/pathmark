import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectTagFromCwd, workspaceTagFromCwd } from "./codex/capture.js";
import { deterministicId } from "./ids.js";
import { redactSecrets } from "./redact.js";
import { namespaceTag } from "./store.js";
import { QUARANTINED_MEMORY_TAG } from "./memory-safety.js";
// Claude Code keeps one auto-memory directory per project, with one fact per Markdown file:
//   ~/.claude/projects/<cwd-slug>/memory/<name>.md   (+ a MEMORY.md index, which is skipped)
// Each file becomes raw evidence, never a conclusion, so Pathmark's approval gate still decides
// what is recalled as durable intent.
export const CLAUDE_CODE_MEMORY_TAG = "claude-code-memory";
const INDEX_FILE = "MEMORY.md";
const CWD_SCAN_BYTES = 64 * 1024;
export function defaultClaudeProjectsDir() {
    return path.join(process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude"), "projects");
}
export async function readClaudeCodeMemories(root, projectFilter) {
    const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
    const memories = [];
    for (const project of projects) {
        if (!project.isDirectory())
            continue;
        if (projectFilter && !project.name.toLowerCase().includes(projectFilter.toLowerCase()))
            continue;
        const projectDir = path.join(root, project.name);
        const memoryDir = path.join(projectDir, "memory");
        const files = (await readdir(memoryDir).catch(() => [])).filter((file) => file.endsWith(".md") && file !== INDEX_FILE);
        if (!files.length)
            continue;
        const cwd = (await projectCwd(projectDir)) ?? (await resolveSlugPath(project.name));
        for (const file of files.sort()) {
            const fullPath = path.join(memoryDir, file);
            const [raw, info] = await Promise.all([readFile(fullPath, "utf8"), stat(fullPath)]);
            const parsed = parseMemoryMarkdown(raw, path.basename(file, ".md"));
            if (!parsed.text)
                continue;
            memories.push({
                id: deterministicId(["claude-code-memory", project.name, file]),
                file: fullPath,
                projectSlug: project.name,
                cwd,
                name: parsed.name,
                type: parsed.type,
                text: parsed.text,
                modifiedAt: info.mtime.toISOString(),
            });
        }
    }
    return memories;
}
export function parseMemoryMarkdown(raw, fallbackName) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
    const frontmatter = match ? frontmatterFields(match[1]) : new Map();
    const body = (match ? raw.slice(match[0].length) : raw).trim();
    const name = frontmatter.get("name") || fallbackName;
    const description = frontmatter.get("description");
    const text = description && !body.includes(description) ? `${description}\n\n${body}`.trim() : body;
    return { name, type: frontmatter.get("type"), text };
}
// Flat `key: value` pairs only; nested keys (e.g. `metadata:\n  type: x`) are flattened to their leaf name.
function frontmatterFields(block) {
    const fields = new Map();
    for (const line of block.split(/\r?\n/)) {
        const match = /^\s*([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
        if (!match || !match[2])
            continue;
        fields.set(match[1].toLowerCase(), match[2].replace(/^(["'])(.*)\1$/, "$2"));
    }
    return fields;
}
// The directory slug is lossy (every non-alphanumeric becomes "-"), so recover the real cwd
// from a session transcript in the same project directory when one exists.
async function projectCwd(projectDir) {
    const entries = await readdir(projectDir).catch(() => []);
    const transcripts = entries.filter((entry) => entry.endsWith(".jsonl"));
    for (const transcript of transcripts) {
        const head = await readHead(path.join(projectDir, transcript));
        const match = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(head);
        if (!match)
            continue;
        try {
            return JSON.parse(match[1]);
        }
        catch {
            continue;
        }
    }
    return undefined;
}
const SLUG_UNSAFE = /[^A-Za-z0-9]/g;
const MAX_SLUG_DEPTH = 24;
// Fallback when no transcript survives: walk the real filesystem from "/" and pick directory
// names whose slug form ("/" and other non-alphanumerics become "-") consumes the slug exactly.
export async function resolveSlugPath(slug, base = path.parse(process.cwd()).root) {
    return walkSlug(slug, base, 0);
}
async function walkSlug(remaining, dir, depth) {
    if (!remaining)
        return dir;
    if (depth >= MAX_SLUG_DEPTH || !remaining.startsWith("-"))
        return undefined;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const candidates = entries
        // Symlinked directories count too (macOS /var -> /private/var); a symlink to a file just fails readdir.
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => ({ name: entry.name, slug: `-${entry.name.replace(SLUG_UNSAFE, "-")}` }))
        .filter(({ slug }) => remaining.startsWith(slug) && (remaining.length === slug.length || remaining[slug.length] === "-"))
        .sort((left, right) => right.slug.length - left.slug.length);
    for (const candidate of candidates) {
        const found = await walkSlug(remaining.slice(candidate.slug.length), path.join(dir, candidate.name), depth + 1);
        if (found)
            return found;
    }
    return undefined;
}
async function readHead(file) {
    try {
        const handle = await open(file, "r");
        try {
            const buffer = Buffer.alloc(CWD_SCAN_BYTES);
            const { bytesRead } = await handle.read(buffer, 0, CWD_SCAN_BYTES, 0);
            return buffer.subarray(0, bytesRead).toString("utf8");
        }
        finally {
            await handle.close();
        }
    }
    catch {
        return "";
    }
}
export function nativeMemoryDraft(memory, options) {
    const tags = [CLAUDE_CODE_MEMORY_TAG];
    if (memory.type)
        tags.push(`memory-type:${memory.type.toLowerCase()}`);
    const projectTag = projectTagFromCwd(memory.cwd) ?? `claude-project:${memory.projectSlug.toLowerCase().replace(/^-+/, "")}`;
    tags.push(projectTag);
    const workspaceTag = workspaceTagFromCwd(memory.cwd);
    if (workspaceTag)
        tags.push(workspaceTag);
    if (options.namespace)
        tags.push(namespaceTag(options.namespace));
    const text = options.redact ? redactSecrets(memory.text).text : memory.text;
    return {
        id: memory.id,
        kind: "memory",
        text,
        tags,
        source: `claude-code:auto-memory:${memory.projectSlug}/${memory.name}`,
        createdAt: memory.modifiedAt,
        updatedAt: memory.modifiedAt,
    };
}
// Re-runnable sync: new files are added, edited files update in place (Pathmark keeps the prior
// version in history), identical files are left alone. Files deleted natively are not deleted here.
export async function importClaudeCodeMemories(store, memories, options) {
    const result = {
        applied: !options.dryRun,
        scanned: memories.length,
        created: 0,
        updated: 0,
        unchanged: 0,
        deletedInPathmark: 0,
        projects: new Set(memories.map((memory) => memory.projectSlug)).size,
    };
    const additions = [];
    for (const memory of memories) {
        const draft = nativeMemoryDraft(memory, options);
        const existing = await store.get(memory.id, { includeDeleted: true });
        // A record the user deleted in Pathmark stays deleted; the native file does not resurrect it.
        if (existing?.deletedAt) {
            result.deletedInPathmark += 1;
            continue;
        }
        if (!existing) {
            result.created += 1;
            additions.push(draft);
            continue;
        }
        if (existing.text === draft.text && sameTags(existing.tags, draft.tags ?? [])) {
            result.unchanged += 1;
            continue;
        }
        result.updated += 1;
        if (!options.dryRun)
            await store.update(memory.id, { text: draft.text, tags: draft.tags, source: draft.source });
    }
    if (!options.dryRun && additions.length)
        await store.addRecords(additions);
    return result;
}
// Compare the way the store persists tags (trimmed, lowercased, deduped); ignore the quarantine
// tag the store adds on its own.
function sameTags(stored, draft) {
    const normalize = (tags) => [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag && tag !== QUARANTINED_MEMORY_TAG))]
        .sort()
        .join("\n");
    return normalize(stored) === normalize(draft);
}
//# sourceMappingURL=native-memory.js.map