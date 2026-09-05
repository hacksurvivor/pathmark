# Scratchpad review → Pathmark decision

Development preview on `codex/decision-assurance`. Build this checkout and use `node dist/index.js`; the published Pathmark 0.1.15 package does not yet include this bridge. Scratchpad's producer is the published `codex-scratchpad-plugin@0.4.0`.

The bridge accepts the JSON sent by Scratchpad's existing review panel, including its `Scratchpad review for "…":` message wrapper. It stores the exact artifact revision label, relative path, full SHA-256, reported feedback/change-request/approval decision, notes, selection, and caller-attributed source. It hashes the supplied payload for traceability and redacts secrets in textual evidence. Importing creates raw evidence only, even when the payload says `approve`.

## Use a review delivered to your task

1. Read the originating user review and its scope. Use the complete delivered JSON; do not reconstruct a historical approval hash from today's file.
2. Obtain the artifact's session directory from Scratchpad's `scratchpad` tool or its previously returned absolute file path. Keep an approved artifact at that path while relying on its hash. If it is removed or moved, verification becomes unavailable; preserve durable approved designs in the project and obtain a review bound to their durable location.
3. Import into an explicit project scope with a source pointing to the originating task/message. Inspect `artifactCheck` before applying the review.

```bash
PATHMARK_STORE_DIR=/absolute/path/to/pilot-store \
node dist/index.js review scratchpad \
  --artifact-root=/absolute/path/to/session/scratchpad \
  --source=codex://threads/TASK_ID#MESSAGE_ID \
  --tag=project:my-project < delivered-review.json
```

Use a real directory and source identifier. The CLI's `--artifact-root` explicitly allows reads there for that invocation. With no scope tag, `review` and `decision` use the project at `--cwd=DIR`, or the current working directory.

For MCP, configure allowed directories in the Pathmark server environment. The value is a JSON array encoded as a string:

```json
{
  "env": {
    "PATHMARK_ARTIFACT_ROOTS": "[\"/absolute/path/to/approved-artifacts-parent\"]"
  }
}
```

Or in a shell:

```bash
export PATHMARK_ARTIFACT_ROOTS='["/absolute/path/to/approved-artifacts-parent"]'
```

Then call `import_scratchpad_review` with `review` (the delivered message string), `artifactRoot` (the specific session directory inside that allowed parent), `source`, and `tags` or `namespace`. An MCP caller cannot widen the server's configured directories through tool arguments. Restart the server after changing its environment. No directories are enabled by default.

## Preserve useful intent and check it again

When the review contains durable intent, use the returned `evidence.id` with `create_conclusion` or `decision propose`. Include the intended behavior, rationale, owner, and checks against explicit plan facts. The normal revision-bound conclusion workflow still applies. A faithfully recorded, explicitly authorized user decision can reuse that existing authorization; importing a copied `approve` field is not evidence that the user authorized a broader proposal.

`task_brief` now includes `artifactReviews` alongside each applicable decision. `check_decisions` verifies linked artifact hashes before evaluating plan facts. A changed, missing, malformed, oversized, or inaccessible artifact makes the result `unknown` with `reconsider: true`. Matching bytes allow the existing decision predicates to run. Feedback and change requests retain their original reported status and are never silently converted to approval.

```bash
node dist/index.js review artifact --id=EVIDENCE_ID \
  --artifact-root=/absolute/path/to/session/scratchpad

node dist/index.js decision check --tag=project:my-project \
  --artifact-root=/absolute/path/to/session/scratchpad < plan.json
```

MCP also exposes `check_artifact_review` by evidence ID. `PATHMARK_ARTIFACT_ROOTS` can allow multiple trusted artifact parents for either interface. Files are constrained to relative HTML paths under the bound directory, symlink containment, and 2 MiB, matching Scratchpad's HTML limit. Pathmark reads and hashes the HTML without executing it or storing its contents.

A hash match establishes that the local HTML matches the reported review at check time. It does not authenticate the source, approve a conclusion, verify the running product against the design, or authorize deployment. Ordinary plan facts remain caller assertions. The existing product design and implementation checks remain necessary.

## Reproduce the package-to-package handoff

After installing Scratchpad 0.4.0 into a disposable directory, run:

```bash
npm run build
node scripts/demo-scratchpad-handoff.mjs /absolute/path/to/node_modules/codex-scratchpad-plugin
```

This starts the actual installed Scratchpad MCP server, opens HTML, executes its actual viewer script in a simulated DOM/host, captures the emitted review, imports it over Pathmark MCP, proposes and approves a **synthetic** decision, and verifies it from another MCP client. Changing the artifact produces `unknown`. It removes its isolated artifacts and memory store afterward.

The demo verifies protocol and data compatibility. It does not send a live Codex review, simulate a real user's approval, or measure a productivity advantage over good instructions. See [verification evidence](validation/scratchpad-handoff.md).
