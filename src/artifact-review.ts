import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { redactSecrets } from "./redact.js";
import type { PathmarkStore } from "./store.js";
import type { PathmarkConfig, PathmarkRecord } from "./types.js";

const MAX_REVIEW_CHARS = 32_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const REVIEW_TAG = "scratchpad-review";
const SCHEMA = "pathmark.scratchpad-review/v1";
const subpathSchema = z.string().min(1).max(2000).refine((value) =>
  !path.isAbsolute(value) && !/[\\:\0]/.test(value) &&
  !value.split("/").some((part) => part === ".." || part === "" || part === ".") && /\.html?$/i.test(value),
"Artifact subpath must be a relative HTML file without traversal");

export const scratchpadReviewSchema = z.object({
  artifact: z.object({ title: z.string().max(1000), revision: z.string().min(1).max(1000),
    subpath: subpathSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  decision: z.enum(["feedback", "changes", "approve"]),
  notes: z.string().max(16_000),
  selection: z.unknown().optional(),
}).strict();

const envelopeSchema = z.object({
  schema: z.literal(SCHEMA), review: scratchpadReviewSchema,
  artifactRoot: z.string().min(1).max(4000),
  source: z.string().min(1).max(2000),
  authority: z.literal("reported-review-only"),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface ArtifactReviewCheck {
  evidenceId: string;
  status: "match" | "changed" | "unavailable";
  reason: string;
  checkedAt: string;
  artifact?: z.infer<typeof scratchpadReviewSchema>["artifact"];
  reportedDecision?: "feedback" | "changes" | "approve";
  actualSha256?: string;
  source?: string;
  authority: "reported-review-only";
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function allowedRoot(config: PathmarkConfig, root: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new Error("artifactRoot must be an absolute directory");
  const canonical = await realpath(root);
  for (const allowed of config.artifactRoots ?? []) {
    try { if (inside(await realpath(allowed), canonical)) return canonical; } catch { /* An unavailable root grants no access. */ }
  }
  throw new Error("Artifact directory is not allowed. Configure PATHMARK_ARTIFACT_ROOTS or CLI --artifact-root.");
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new Error("Review selection is nested too deeply");
  if (typeof value === "string") return redactSecrets(value).text;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactSecrets(key).text, redactValue(item, depth + 1)]));
  return value;
}

export async function importScratchpadReview(store: PathmarkStore, config: PathmarkConfig, input: {
  review: string; artifactRoot: string; source: string; tags: string[];
}) {
  if (!input.tags.some((tag) => /^(project-id|project|workspace|namespace|session):.+/.test(tag))) throw new Error("A project or namespace scope is required");
  if (input.review.length > MAX_REVIEW_CHARS) throw new Error("Review exceeds 32000 characters");
  // Accept exactly the JSON object, or the viewer's user-message wrapper. Do not scan arbitrary prose for JSON.
  const text = input.review.trim();
  const payload = text.startsWith("Scratchpad review for ") ? text.slice(text.indexOf("\n") + 1) : text;
  const parsed = scratchpadReviewSchema.parse(JSON.parse(payload));
  const artifactRoot = await allowedRoot(config, input.artifactRoot);
  if (redactSecrets(parsed.artifact.subpath).redacted || redactSecrets(artifactRoot).redacted) throw new Error("Artifact paths must not contain secrets");
  const envelope = envelopeSchema.parse({ schema: SCHEMA, review: redactValue(parsed), artifactRoot,
    source: redactSecrets(input.source).text, authority: "reported-review-only", payloadSha256: createHash("sha256").update(payload).digest("hex") });
  const record = await store.add({ kind: "memory", text: JSON.stringify(envelope),
    tags: [...input.tags, REVIEW_TAG], source: "scratchpad:review" }, { dedupe: true });
  return { evidence: record, artifactCheck: await checkArtifactReview(record, config),
    instruction: "This is reported review evidence, not authenticated approval. Verify the originating user message before acting. Propose durable intent through the existing conclusion workflow; importing never approves a conclusion." };
}

export async function checkArtifactReview(record: PathmarkRecord, config: PathmarkConfig): Promise<ArtifactReviewCheck | undefined> {
  if (!record.tags.includes(REVIEW_TAG) && record.source !== "scratchpad:review") return undefined;
  const result: ArtifactReviewCheck = { evidenceId: record.id, status: "unavailable", reason: "Invalid Scratchpad review evidence",
    checkedAt: new Date().toISOString(), authority: "reported-review-only" };
  let envelope: z.infer<typeof envelopeSchema>;
  try { envelope = envelopeSchema.parse(JSON.parse(record.text)); } catch { return result; }
  result.artifact = envelope.review.artifact; result.reportedDecision = envelope.review.decision; result.source = envelope.source;
  try {
    const root = await allowedRoot(config, envelope.artifactRoot);
    const target = await realpath(path.resolve(root, envelope.review.artifact.subpath));
    if (!inside(root, target)) throw new Error("Artifact symlink escapes its bound directory");
    // Nonblocking avoids hanging on a substituted FIFO. O_NOFOLLOW rejects a final symlink swap.
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size > MAX_HTML_BYTES) throw new Error("Artifact must be a regular HTML file of at most 2 MiB");
      const bytes = Buffer.alloc(MAX_HTML_BYTES + 1);
      let total = 0;
      while (total < bytes.length) {
        const { bytesRead } = await file.read(bytes, total, bytes.length - total, null);
        if (!bytesRead) break;
        total += bytesRead;
      }
      const after = await file.stat();
      const current = await stat(target);
      if (total > MAX_HTML_BYTES || before.size !== total || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
        current.ino !== before.ino || current.dev !== before.dev || current.mtimeMs !== before.mtimeMs ||
        await realpath(path.resolve(root, envelope.review.artifact.subpath)) !== target) throw new Error("Artifact changed during verification; retry the check");
      const html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, total));
      if (html.includes("\0")) throw new Error("Artifact contains invalid NUL bytes");
      result.actualSha256 = createHash("sha256").update(html).digest("hex");
      result.status = result.actualSha256 === envelope.review.artifact.sha256 ? "match" : "changed";
      result.reason = result.status === "match" ? "Current HTML matches the reported reviewed revision. This does not authenticate approval or verify implementation fidelity." : "HTML changed since the reported review. Reopen review before reusing this decision.";
    } finally { await file.close(); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    result.reason = code === "ENOENT" ? "Reviewed artifact is missing" : code ? `Artifact cannot be verified (${code})` : (error as Error).message;
  }
  return result;
}
