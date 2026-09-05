# Scratchpad handoff verification — September 5, 2026

The Pathmark bridge is a local development change, independent of Scratchpad's completed npm release.

## Release evidence

`npm publish` completed successfully for `codex-scratchpad-plugin@0.4.0` after the user completed npm authentication. `npm view` returned the published version and tarball metadata. A fresh registry install with install scripts disabled passed executable startup, MCP handshake, the updated tool schema, HTML preview opening, and viewer resource loading.

- Registry package: https://www.npmjs.com/package/codex-scratchpad-plugin/v/0.4.0
- GitHub release: https://github.com/hacksurvivor/scratchpad/releases/tag/v0.4.0
- Published tarball SHA-256: `492f81ca91e4fc3b461b668e96f3cc156f573b7db04437ee3432d672a0b7c29b`
- Registry/install integrity: `sha512-aaIaQTM26KET/dYfIeJ0a5j5MzUnVzIqCJNPqG+G2uu7z00eaIKGz0YvK458veVbYw1Idz4r/j/G9DQG+abPHQ==`
- Installed viewer SHA-256: `f442d99b82c4e6db3981e3a9f7f27e15c984c6ee06a49ab0507d546498cb8362`

## Pathmark verification

`npm test` passed the build, all 15 runtime scripts, and ESLint. The new `test-artifact-review.mjs` covers six grouped scenarios over actual MCP and CLI processes with disposable files/stores:

- Complete review/provenance capture, idempotent reimport, separate feedback/change-request/approval evidence, and no automatic conclusion approval.
- Separate-client decision reuse, plan conflict, changed/missing HTML, disabled file access, and project isolation.
- Traversal and symlink containment, unsupported file types, and explicit root boundaries.
- Invalid and oversized payloads, structured secret redaction, invalid UTF-8/NUL content, and oversized files.
- CLI import/check with explicit artifact root and project directory.
- Source edits invalidating the decision's bound evidence revision.

The CI coverage gates also passed: 92.19% statements/lines, 80.75% branches, and 97.54% functions overall. The artifact-review module reached 98.42% statements/lines, 90% branches, and 100% functions. ESLint passed again after adding the package-to-package demo.

The package-to-package demo also passed against the **fresh npm-installed Scratchpad 0.4.0**, using its real MCP server and viewer JavaScript. The emitted payload retained `R1`, full SHA-256, `approve`, notes, and layout selection. Pathmark imported raw evidence, left the proposal pending, then checked a synthetically approved decision from another client. Matching HTML produced `pass`; changed HTML produced `unknown`.

## Limits and pilot interpretation

The DOM, host message delivery, and reviewer in the demo are fixtures. Live delivery through Codex's real review host is still unverified. No public Pathmark package or shared installation was replaced. Existing installed Pathmark clients need a separately reviewed update before these tools are available there.

The earlier Scratchpad implementation remains a retrospective case with unmeasured Pathmark exposure. This bridge adds functional evidence, not a causal productivity result. The existing coding comparison found 8/8 accepted implementations under all three conditions; this work does not change that result or establish superiority to curated instructions.
