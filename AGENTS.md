# Pathmark

Local, cross-harness memory for coding agents: an MCP server plus CLI (`pathmark`) that captures sessions from Claude
Code and Codex, consolidates them into approved conclusions, and recalls them. Public repo `hacksurvivor/pathmark`,
published to npm as `pathmark` and to the MCP Registry as `io.github.hacksurvivor/pathmark`. Personal GitHub account.

## Values

- Never inject a wrong memory: raw sessions are evidence, only approved conclusions are trusted; when unsure, leave a
  proposal pending.
- Every change keeps history (supersede, soft delete, backups before rewrites). Memory records are untrusted input.

## Run and check

- `npm ci`, then `npm test` (build + every `scripts/test-*.mjs` + ESLint). `npm run coverage` and `npm audit` before a
  release. Node 22.5+ (uses `node:sqlite`).
- Tests make their own temp stores through `PATHMARK_STORE_DIR`; they never touch `~/.pathmark`.
- Try a change against real data on a copy: `cp ~/.pathmark/memory/memory.jsonl /tmp/x/ && PATHMARK_STORE_DIR=/tmp/x
  node dist/index.js <command>`. `dream` with `PATHMARK_SYNTHESIS_PROVIDER=claude` uses the owner's Claude subscription.

## Ship

- PRs to `main` (protected, CI required). `dist/` is committed: rebuild (`npm run build`) before committing.
- A release bumps the version in `package.json`, `package-lock.json`, `server.json`, `CITATION.cff`, `codemeta.json`
  and `src/mcp.ts` (`npm run release:verify -- --tag=vX.Y.Z` checks), adds `docs/releases/vX.Y.Z.md`, a CHANGELOG line
  and the README "What's New". Then follow `docs/release-checklist.md`: signed tag `vX.Y.Z` starts `publish.yml` (npm
  trusted publishing), then `gh release create`. Publishing is public: needs the owner's go-ahead.
- `publish-mcp.yml` (MCP Registry) is a separate manual dispatch with explicit approval; registry versions are immutable.
- After a release, install it on both machines (PC: mise global npm; Mac: `~/.npm-global`) and restart MCP hosts:
  long-running hosts keep the old build.

## Map

- `src/store.ts`: canonical JSONL store + rebuildable SQLite index (`memory.index.v5.sqlite`), locks, compaction, merge.
- `src/codex/`: capture hooks and transcript parsing (shared by Claude Code via `src/hook-cli.ts`).
- `src/consolidate.ts` (bounded batches for an agent), `src/dream.ts` (unattended nightly consolidation).
- `src/mcp.ts`: MCP tools and server instructions. `src/manage.ts`: CLI management commands.

## Gotchas

- The SQLite index is derived from `memory.jsonl`: delete it to rebuild, never repair it in place.
- Claude synthesis must not use `claude --bare` (API-key only, breaks subscription users). It runs with no tools, no MCP,
  hooks disabled and a fixed cwd so it never captures itself or litters `~/.claude/projects`.
- Plain `import` only adds records. Syncing two stores needs `export --include-deleted` + `import --merge`, and
  compaction must keep tombstones (`--tombstone-days`) or deletes come back.
- Tests with fixed dates go stale against "now"-relative windows: pin the clock (`mock.timers`, see
  `scripts/test-consolidate.mjs`).
