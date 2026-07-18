# OpenAI Build Week 2026 implementation record

Pathmark is entered in the **Developer Tools** track. It gives coding agents one local, inspectable memory layer so developers can move between Codex, Claude Code, opencode, Gemini CLI, Cursor, and other MCP clients without repeatedly reconstructing project context.

This document separates the pre-existing project from the work completed during the OpenAI Build Week submission period.

## Submission-period boundary

- Challenge submission period opened: July 13, 2026 at 9:00 AM Pacific Time.
- Pre-challenge baseline: `4c0e87dfdbd2ba4c643abd8b887cc228bdb08b73` (`v0.1.5`).
- Qualifying implementation began: July 14, 2026 in Bangkok, after the submission period opened.
- Primary Codex session: `019f5fc3-d7e6-7b41-8a30-d161c90b98fb`.
- Codex model: `gpt-5.6-sol`.
- Qualifying releases: `v0.1.6` and `v0.1.7`.

The repository diff from the baseline through `v0.1.7` contains 3,265 additions and 193 deletions across 66 files. Pre-existing functionality is not presented as new challenge work.

Pathmark and the Build Week submission are solely owned by Sergey Moloman. The `co-ode local bridge <local-bridge@co-ode.local>` identity found in historical Git metadata was a temporary local commit transport used in testing, not a person or project contributor. The repository `.mailmap` maps that mechanical identity to Sergey without rewriting published release tags or invalidating npm provenance.

## What existed before Build Week

At the `v0.1.5` baseline, Pathmark already provided:

- a local canonical JSONL memory store with a derived SQLite FTS index;
- MCP memory tools and provider-neutral client-side synthesis;
- Codex prompt-time recall and visible `usedMemories` tracing;
- basic Codex, Claude Code, opencode, Cursor, and Gemini CLI setup;
- secret redaction, tests, npm packaging, and trusted publishing.

## What was built during Build Week

### Safe long-running memory lifecycle (`v0.1.6`)

Codex first audited the live project rather than assuming the previous release was complete. The audit reproduced a concurrency defect: two processes opening a stale index could interpret SQLite `BUSY` as corruption, rename a healthy index, and trigger competing rebuilds. The qualifying implementation then added:

- cross-process index synchronization and correct `BUSY`/`LOCKED` handling;
- atomic recovery limited to verified corruption errors;
- first-class namespaces on every MCP read and write;
- default redaction on MCP ingestion paths;
- record updates, revisions, and explicit superseding;
- expiration and retention controls;
- diagnostics, exact deduplication, backup, and compaction;
- preview-first hard purge with an automatic backup before applying changes;
- scoped mergeable imports and exports;
- optional AES-256-GCM portable exports;
- optional local hybrid reranking with lexical fallback;
- Gemini CLI hooks and generic transcript ingestion for other harnesses.

Primary release commit: `748f9d42fdeb106204b31db7952d27c937d76900`.

### Supply-chain and delivery hardening (`v0.1.7`)

The same Codex session then audited how users receive the package and added:

- GitHub Actions pinned to immutable commit SHAs;
- required Node 22, Node 24, dependency-review, and CodeQL checks;
- npm auditing, Dependabot, OpenSSF Scorecard analysis, and secret scanning;
- removal of owner bypass from the protected `main` branch;
- immutable existing release tags;
- explicit npm SLSA provenance;
- fixes and regression tests for the two findings discovered by the new CodeQL gate.

Release preparation commit: `53464f1ab6ada9d8ff4dfcf173f67064dbb535c9`.

## How Codex and GPT-5.6 contributed

The majority of the qualifying extension was built in one Codex task using GPT-5.6. Codex was used to:

1. inspect the current implementation, tests, live store behavior, npm package, and repository protections;
2. reproduce the SQLite concurrency failure on isolated data before changing the recovery logic;
3. design lifecycle APIs around preview-first and backup-first safety boundaries;
4. implement the TypeScript, MCP, CLI, documentation, and regression-test changes;
5. run build, runtime, coverage, lint, package, npm audit, and live integration checks;
6. open protected pull requests, wait for required checks, fix CodeQL findings, and verify the published packages and provenance.

The human product decisions were to keep Pathmark local-first, provider-neutral, inspectable, dependency-light, and conservative around destructive memory operations. Codex accelerated the audit, implementation, testing, and release work while those constraints remained explicit.

## Fast judge test

Requirements: Node.js 22.5 or newer on macOS, Linux, or Windows.

```bash
git clone https://github.com/hacksurvivor/pathmark.git
cd pathmark
npm ci
npm run build
npm run demo:build-week
```

The Build Week demo starts the real MCP server twice against one isolated temporary store. Session A saves an architectural decision; a fresh Session B recovers it with transparent `usedMemories`, verifies secret redaction, and runs store diagnostics. It does not touch the judge's normal Pathmark store. The broader `npm run smoke` command additionally verifies tool discovery, tag and namespace isolation, updates, and preview-first purge.

To test the published package with Codex:

```bash
npm install -g pathmark@0.1.7
codex mcp add pathmark -- pathmark
pathmark codex install --replace-legacy-hooks
pathmark codex status
```

Then ask Codex to save a project decision with `remember`, start a fresh task, and call `recall_memory` with the same subject. The result includes both the recovered context and the exact memory IDs, timestamps, sources, matches, tags, and previews used.

## Supported platforms

- Operating systems: macOS, Linux, and Windows with Node.js 22.5+.
- Native setup helpers: Codex, Claude Code, opencode, Gemini CLI, Kimi, and other documented harnesses.
- Generic integration: any client capable of launching a local stdio MCP server.
- Storage: local JSONL source of truth plus a disposable derived SQLite FTS index.

## Verification references

- Release notes: [`v0.1.6`](releases/v0.1.6.md) and [`v0.1.7`](releases/v0.1.7.md).
- Runtime test: [`scripts/smoke.mjs`](../scripts/smoke.mjs).
- Compatibility guide: [`docs/compatibility.md`](compatibility.md).
- Public npm package: <https://www.npmjs.com/package/pathmark>.
- Source repository: <https://github.com/hacksurvivor/pathmark>.
