# Pathmark

Carry intent across agents without turning stale code facts into hidden memory.

<p align="center">
  <a href="https://www.npmjs.com/package/pathmark"><img src="https://img.shields.io/npm/v/pathmark?label=version" alt="current Pathmark npm version"></a>
  <a href="https://www.npmjs.com/package/pathmark"><img src="https://img.shields.io/npm/dt/pathmark?label=npm%20downloads" alt="npm downloads"></a>
  <a href="https://www.npmjs.com/package/pathmark"><img src="https://img.shields.io/npm/dw/pathmark?label=weekly%20downloads" alt="weekly npm downloads"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/hacksurvivor/pathmark"><img src="https://api.scorecard.dev/projects/github.com/hacksurvivor/pathmark/badge" alt="OpenSSF Scorecard"></a>
</p>

## What's New — v0.1.13

Pathmark v0.1.13 closes the loop between proactive recall, conversational answers, and measurable memory quality:

- multi-intent questions retrieve a relevant approved conclusion for each topic instead of collapsing into one noisy match;
- unscoped chat no longer falls back to raw cross-workspace history, and internal instruction captures are excluded from proactive recall and consolidation;
- client-mode `chat` / `ask_memory` return safe answers from approved conclusions plus an exact `recallId` for matched recalls;
- MCP `rate_recall` and CLI `pathmark feedback` turn explicit relevance labels into measured precision and label coverage;
- consolidation exposes stable cursors and eligible-backlog counts so large histories can be reviewed progressively without automatic approval;
- audit separates consolidation-eligible evidence from intentionally excluded raw records, making coverage numbers actionable.

See the [v0.1.13 release notes](docs/releases/v0.1.13.md) or the complete [changelog](CHANGELOG.md). The npm badge above always shows the currently published version.

<p align="center">
  <img src="https://raw.githubusercontent.com/hacksurvivor/pathmark/main/assets/pathmark-hero.png" alt="Pathmark local intent and provenance shared by Codex, Claude Code, opencode, and Gemini CLI" width="100%">
</p>

Pathmark gives Codex, Claude Code, opencode, Gemini CLI, Cursor, and any MCP-capable harness one local intent and provenance layer. Save decisions, constraints, preferences, and approved conclusions once. Use them from the next agent without pasting a recap.

**Code remembers implementation. Pathmark remembers intent.** Repository code, architecture, tests, CI, and intentional agent instructions remain authoritative for how the software works. Raw sessions are searchable evidence, not automatically trusted truth.

Your context stays on disk at `~/.pathmark/memory/memory.jsonl`. You do not need an account, hosted database, API key, or vendor backend to start.

## OpenAI Build Week 2026

Pathmark is a **Developer Tools** submission for OpenAI Build Week 2026. The project existed before the challenge, so the submission is deliberately scoped to the meaningful extension built after the submission period opened on July 13, 2026.

During the eligible period, Codex with GPT-5.6 helped audit and extend Pathmark from a working local memory layer into safer long-running developer infrastructure:

- fixed a reproduced multi-process SQLite index race;
- added revision history, superseding, expiration, retention, diagnostics, backup, compaction, and preview-first hard purge;
- added namespace-scoped reads and writes plus default secret redaction;
- added scoped import/export, optional AES-256-GCM portable exports, local hybrid reranking, and portable harness ingestion;
- hardened CI and npm delivery with required CodeQL and dependency review, immutable Action pins, protected tags, OpenSSF analysis, and SLSA provenance.

The primary Codex session for this work is `019f5fc3-d7e6-7b41-8a30-d161c90b98fb`. The qualifying release range is `v0.1.6` through `v0.1.7`; the pre-challenge baseline is commit `4c0e87dfdbd2ba4c643abd8b887cc228bdb08b73`.

See the [Build Week implementation record](docs/build-week-2026.md) for the before/after boundary, commit evidence, Codex collaboration details, and a fast judge test.

## Why Pathmark

You do not work in one tool. You ask Codex to patch, Claude Code to review, opencode to clean up, and Gemini CLI to challenge the plan. Each tool starts cold unless you carry the context across.

Pathmark gives those tools one place to read and write intent and evidence:

- One local JSONL store across harnesses.
- Standard MCP tools include `remember`, `search_memory`, `recall_memory`, `session_trace`, `rate_recall`, `consolidate_memory`, `audit_memory`, and conclusion-first `chat` / `ask_memory`.
- Client-side synthesis by default, so your coding agent reads the context and answers.
- Optional Codex CLI, local command, and OpenAI-compatible synthesis modes.
- Plain files you can inspect, back up, delete, or migrate.

Pathmark stays provider-neutral. Codex gets one optional synthesis preset. The core server works with any MCP client that can use local tools.

Pathmark requires Node.js 22.5 or newer.

## Cross-Harness Memory

You switch tools during a coding session:

- Codex fixes the failing test.
- Claude Code reviews the patch.
- opencode cleans the diff.
- Gemini CLI challenges the approach.

Pathmark keeps the notes in one store.

Point each harness at the same store:

```text
Codex       \
Claude Code \
opencode     >  Pathmark MCP  >  ~/.pathmark/memory/memory.jsonl
Gemini CLI  /
Cursor     /
```

Install Pathmark in each harness and point them at the same `PATHMARK_STORE_DIR`. One tool saves raw context with `remember` or proposes a durable conclusion with `create_conclusion`; an approved conclusion and raw evidence can then be recovered with `recall_memory`, `search_memory`, `get_context`, or `ask_memory`.

Pathmark sits below the agents as an intent, evidence, and provenance bus for your coding workflow.

## Tools

Pathmark exposes these MCP tools:

| Tool | Purpose |
| --- | --- |
| `remember` | Save raw searchable evidence. Raw evidence is not treated as durable approved intent. |
| `create_conclusion` | Propose a higher-signal durable conclusion or preference. Approval is required by default before recall. |
| `search_memory` | Search memories and conclusions. |
| `recall_memory` | Transparent recall: returns context plus the exact memory IDs, timestamps, sources, matches, tags, and previews used. Accepts optional `tags`, exact `ids`, and compact `includeRecords: false` output. |
| `session_trace` | Return a bounded chronological audit trail for one session: prompts, exact injected memory IDs, redacted tool inputs/results, and answers. |
| `rate_recall` | Label exact IDs from a `chat` / `ask_memory` recall as relevant or irrelevant so audit precision is measured. |
| `get_context` | Return compact context for a task or question. |
| `list_conclusions` | List approved saved conclusions. |
| `list_pending_conclusions` | Review bounded, paginated pending conclusion proposals. |
| `approve_conclusion` | Atomically approve a proposal, optionally correcting text/tags and recording the reviewer. |
| `reject_conclusion` | Retain a rejected proposal in the audit trail while permanently excluding it from recall. |
| `get_memory_snapshot` | Generate a bounded USER/PROJECT/AGENT snapshot from approved canonical conclusions. |
| `consolidate_memory` | Review a bounded unsynthesized evidence batch and optionally stage evidence-backed proposals. Nothing is auto-approved. |
| `delete_memory` | Soft-delete a memory or conclusion by id. |
| `update_memory` | Correct a record while preserving prior versions. |
| `supersede_memory` | Replace an outdated record with a linked current record. |
| `purge_memory` | Preview or apply permanent deletion by id, namespace, tags, source, or date. |
| `audit_memory` | Measure capture-to-recall behavior, unused records, recall age, duplicates, stale raw hits, and whether precision labels exist. |
| `doctor_memory` | Report duplicates, deleted/expired records, conclusions, and index health. |
| `compact_memory` | Preview or apply deduplication, retention, and physical cleanup with an automatic backup. |
| `backup_memory` | Create a point-in-time canonical JSONL backup. |
| `export_memory` | Export a scoped mergeable JSONL bundle, optionally encrypted. |
| `ask_memory` | Return an approved-conclusion answer or scoped raw context, exact provenance, and a recall ID for feedback. |
| `chat` | Chat-compatible alias for `ask_memory`, including multi-intent conclusion retrieval and explicit abstention. |
| `get_config` | Show local store configuration. |

## Quick Start

```bash
npm install -g pathmark
```

Then add the MCP server to your client.

Prefer npm for normal installs. To test the current GitHub `main` branch directly:

```bash
npm install -g --install-links=true github:hacksurvivor/pathmark
```

Generate a setup snippet for your harness:

```bash
pathmark setup list
pathmark setup claude-code
pathmark setup opencode --json
pathmark setup gemini-cli
pathmark setup kimi
```

See [docs/compatibility.md](docs/compatibility.md) for Codex, Claude Code, opencode, Gemini CLI, OpenClaw, Hermes Agent, Grok CLI, Kimi, GLM, and generic MCP setups.

### Codex

```bash
codex mcp add pathmark -- pathmark
```

Codex users can also enable auto-capture:

```bash
pathmark codex install --replace-legacy-hooks
```

When you want the visible "what memory did you use?" entry in Codex, Claude Code, Cursor, opencode, Gemini CLI, Grok-compatible MCP hosts, or any other MCP harness, call the `recall_memory` tool before answering. Codex session start injects an approved conclusion snapshot. Before non-trivial prompts, Codex recalls approved conclusions first and uses fresh scoped raw evidence only as a bounded fallback. `recall_memory` remains the portable visible trace across harnesses.

### Claude Code

```bash
claude mcp add pathmark -- pathmark
```

### opencode / Gemini CLI

Use the generated snippets:

```bash
pathmark setup opencode
pathmark setup gemini-cli
```

### Claude Desktop

Add this to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "pathmark": {
      "command": "pathmark",
      "env": {
        "PATHMARK_STORE_DIR": "~/.pathmark/memory"
      }
    }
  }
}
```

### Cursor

Add the same command to Cursor's MCP server settings:

```json
{
  "mcpServers": {
    "pathmark": {
      "command": "pathmark"
    }
  }
}
```

## Local Development

```bash
npm install
npm test
npm run coverage
```

Run directly:

```bash
PATHMARK_STORE_DIR=.pathmark npm run dev
```

## Import Legacy Memory

Pathmark can import a compatible local JSONL memory store without deleting or moving the source files.

```bash
npm run import:legacy -- --source-dir ~/old-codex-memory
```

Defaults:

```text
Legacy source:   ~/.pathmark/legacy/codex
Pathmark target: ~/.pathmark/memory/memory.jsonl
```

The importer creates a `memory.jsonl.backup-*` file before writing, uses deterministic ids so reruns skip duplicates, and redacts obvious `KEY=...`, `TOKEN=...`, `PASSWORD=...`, and `Bearer ...` values.
It uses the same store lock as live MCP and Codex writers, so an import cannot overwrite records captured concurrently.

Use a dry run first when migrating another machine:

```bash
npm run import:legacy -- --source-dir ~/old-codex-memory --dry-run
```

## Codex Auto-Capture

Install Pathmark as the Codex memory adapter:

```bash
pathmark codex install --replace-legacy-hooks
```

This registers the Pathmark MCP server, enables Codex hooks, and removes old compatible hook commands from Codex. It does not delete or move memory files.

The Codex adapter is proactive by default:

- user prompts, final assistant answers, and tool activity are captured locally; intermediate Codex commentary is excluded;
- tool activity records include bounded redacted input previews and hashes, status, exit code, duration, and changed files when the hook provides them;
- tool-output hashes are captured for correlation, while output text remains private by default and requires `PATHMARK_CODEX_CAPTURE_TOOL_OUTPUTS=on`;
- activity records expire after 30 days and are physically capped at 5,000 records by default;
- session start/resume generates one bounded USER/PROJECT/AGENT snapshot from approved canonical conclusions and does not inject raw session history;
- each non-trivial user prompt searches approved workspace/project conclusions first, then approved global or explicitly named-project conclusions;
- only when no approved conclusion matches, at most two raw records from the current workspace/project/session may be injected as a high-confidence fallback;
- raw fallback records must be within the separate automatic-recall horizon, 30 days by default; the full raw archive remains available to explicit `search_memory` and `recall_memory` calls;
- raw cross-project history is never injected automatically; promote durable cross-project intent through the approval workflow;
- broad cross-project history remains available through explicit `search_memory` / `recall_memory` calls without silently entering every prompt;
- when matching memory is found, Codex receives an instruction to call `recall_memory` with the exact pre-capture result IDs and workspace tag, so the UI cannot mistake the newly saved prompt for previously used memory;
- prompt context applies relevance and near-duplicate filtering before injection, and automatic visible recall omits the redundant full `records` copy;
- legacy transport envelopes and assistant progress updates are excluded from session-start and proactive relevance results, while realtime delegation envelopes retain only their current `<input>` payload;
- records containing Pathmark boundary escapes, instruction-override patterns, or invisible Unicode controls are tagged `memory-quarantined` and excluded from automatic recall; injected previews are escaped and explicitly treated as untrusted historical data;
- no matching memory means no extra context is injected.

Durable extraction is approval-gated by default. `create_conclusion` creates a pending proposal; pending and rejected conclusions stay in the canonical JSONL audit trail but are structurally excluded from normal search, exact-ID recall, prompt injection, and snapshots. Use `list_pending_conclusions`, then `approve_conclusion` or `reject_conclusion`. Conclusions created before this workflow are treated as already approved for backward compatibility. Raw `remember` records remain searchable evidence and are not promoted automatically.

The session snapshot is generated from the same canonical store rather than maintained as a second flat file. It is frozen in the session-start hook output; prompt-time scoped recall remains dynamic.

Set `PATHMARK_CODEX_PROACTIVE_RECALL=off` if you want Codex hooks to capture memory but stop prompt-time recall.
Set `PATHMARK_CODEX_VISIBLE_RECALL=off` if you want prompt-time recall without the visible `recall_memory` tool-call request.

`recall_memory` is a point-in-time record of memory used before an answer. It intentionally does not include commands that run later. Use `session_trace` with the exact session ID to inspect the chronological prompt → injected memories → tools/results → final-answer trail. When explicitly enabled, output previews are capped at 2,000 characters and redacted before storage; hashes preserve correlation without storing output text by default. Upgrading an existing cursor migrates to final-answer-only parsing without duplicating previously captured user or final-answer turns. When the original transcript is available, exact legacy `phase: "commentary"` records are soft-deleted by timestamp and text during that migration.

Use `--replace-legacy-hooks` when you want Pathmark hooks to take over from earlier compatible hook commands. Without it, Pathmark installs alongside existing hook commands.

Check the adapter status:

```bash
pathmark codex status
```

The status output is JSON and includes Pathmark hook state, MCP registration state, legacy hook presence, the active store paths, and the current record count.

Remove Pathmark hooks and MCP registration without deleting memory:

```bash
pathmark codex uninstall
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PATHMARK_STORE_DIR` | `~/.pathmark/memory` | Directory for `memory.jsonl`. |
| `PATHMARK_MAX_SEARCH_RESULTS` | `12` | Default search limit. |
| `PATHMARK_CODEX_PROACTIVE_RECALL` | `on` | Automatically inject relevant Pathmark context before non-trivial Codex prompts. Use `off` to capture without prompt-time recall. |
| `PATHMARK_CODEX_VISIBLE_RECALL` | `on` | Ask Codex to call `recall_memory` when prompt-time recall found context, so the UI shows the exact `usedMemories`. |
| `PATHMARK_CODEX_CAPTURE_TOOL_OUTPUTS` | `off` | Store bounded redacted tool-output previews. Output hashes, status, duration, and exit codes remain available when this is off. |
| `PATHMARK_CODEX_MEMORY_SNAPSHOT` | `on` | Generate a bounded approved-conclusion snapshot at Codex session start/resume. |
| `PATHMARK_SNAPSHOT_CHARS` | `4000` | Character budget for generated snapshots; clamped to 500–12000. |
| `PATHMARK_CODEX_RAW_RECALL_DAYS` | `30` | Prompt-time eligibility horizon for raw evidence. `0` disables automatic raw fallback without deleting or hiding explicit search results. |
| `PATHMARK_CODEX_RAW_RECALL_LIMIT` | `2` | Maximum fresh raw records injected when no approved conclusion matches. Clamped to 0–2. |
| `PATHMARK_CODEX_PROACTIVE_CONSOLIDATION` | `on` | At session start, nudge Codex to review a bounded evidence batch when scoped raw history is accumulating without conclusions. |
| `PATHMARK_CONSOLIDATION_MIN_EVIDENCE` | `8` | Minimum unsynthesized user/assistant records before the proactive consolidation nudge appears. |
| `PATHMARK_CONCLUSION_APPROVAL` | `on` | Stage new conclusions for explicit approval. Set `off` only for trusted legacy automation. |
| `PATHMARK_SYNTHESIS_PROVIDER` | `client` | `client`, `command`, `codex`, or `openai-compatible`. |
| `PATHMARK_CHAT_COMMAND` | unset | Command provider: receives a synthesized prompt on stdin and writes an answer on stdout. |
| `PATHMARK_CODEX_COMMAND` | `codex` | Codex provider command. |
| `PATHMARK_CODEX_MODEL` | unset | Optional Codex model override. |
| `PATHMARK_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL. |
| `PATHMARK_OPENAI_API_KEY` | unset | OpenAI-compatible API key. |
| `PATHMARK_OPENAI_MODEL` | unset | Model id for OpenAI-compatible synthesis. |
| `PATHMARK_CHAT_TIMEOUT_MS` | `120000` | Synthesis command timeout. |
| `PATHMARK_NAMESPACE` | unset | Default namespace applied consistently to MCP reads and writes. |
| `PATHMARK_REDACT_MCP_WRITES` | `on` | Redact common secret-shaped values on `remember`, conclusion, update, supersede, import, and ingest paths. |
| `PATHMARK_RETENTION_DAYS` | `0` | Retention policy used by compaction; `0` disables age-based removal. Conclusions are retained. |
| `PATHMARK_ACTIVITY_RETENTION_DAYS` | `30` | Automatic lifetime for recall/tool activity records; `0` disables age-based activity expiry. |
| `PATHMARK_ACTIVITY_MAX_RECORDS` | `5000` | Physical cap for activity records; oldest activity is removed automatically. `0` disables the count cap. |
| `PATHMARK_RERANK_COMMAND` | unset | Optional trusted local embedding/vector or hybrid reranker. Strict kind/tag/namespace filters are applied before candidates leave the store; the command receives query/candidates as JSON on stdin and returns ranked memory ids. |
| `PATHMARK_HYBRID_CANDIDATES` | `500` | Maximum candidates sent to the optional reranker. |
| `PATHMARK_RETRIEVAL_TIMEOUT_MS` | `30000` | Timeout for the optional reranker. |
| `PATHMARK_EXPORT_KEY` | unset | Passphrase for AES-256-GCM portable exports/imports. Never returned by `get_config`. |
| `PATHMARK_INDEX_LOCK_TIMEOUT_MS` | `120000` | Cross-process wait limit for index initialization or rebuild. |

## Synthesis Modes

Pathmark separates memory from reasoning.

### `client`

Default. The MCP server returns relevant memory context, and your MCP client model synthesizes the answer. This works across Codex, Claude Desktop, Cursor, and any other MCP client without giving Pathmark a model credential.

```bash
PATHMARK_SYNTHESIS_PROVIDER=client pathmark
```

### `command`

Use any local subscription or model CLI that accepts a prompt on stdin and writes an answer to stdout:

```bash
PATHMARK_SYNTHESIS_PROVIDER=command \
PATHMARK_CHAT_COMMAND="your-ai-cli --model your-model" \
pathmark
```

This is the general path for users with another paid subscription CLI or a local model runner.

### `codex`

Use the proven Codex CLI bridge. It runs a controlled, non-interactive `codex exec` turn with hooks and memories disabled to avoid recursion:

```bash
PATHMARK_SYNTHESIS_PROVIDER=codex \
PATHMARK_CODEX_MODEL=gpt-5.5 \
pathmark
```

This is useful for Codex users who have persisted ChatGPT/Codex CLI auth locally but do not want to add an OpenAI API key. Pathmark sends the synthesis prompt through stdin, runs Codex in an empty temporary workspace, ignores project rules, and exposes only a minimal environment. Memory records are treated as untrusted data rather than executable instructions.

### `openai-compatible`

Use any provider that exposes `/chat/completions`, including many Kimi, GLM/Z.ai, OpenRouter, LiteLLM, Ollama-compatible gateways, and self-hosted routers:

```bash
PATHMARK_SYNTHESIS_PROVIDER=openai-compatible \
PATHMARK_OPENAI_BASE_URL=https://api.provider.example/v1 \
PATHMARK_OPENAI_API_KEY=... \
PATHMARK_OPENAI_MODEL=... \
pathmark
```

This mode affects MCP `ask_memory` / `chat` and CLI `pathmark chat`. Regular MCP tools still store and retrieve local memory without a model provider.

## Setup CLI

`pathmark setup <client>` prints copy-paste setup for common harnesses. Add `--json` when you want structured output for scripts.

Supported targets:

```text
codex
claude-code
claude-desktop
cursor
opencode
gemini-cli
generic
openai-compatible
command
```

Aliases include `claude`, `gemini`, `kimi`, `glm`, and `z-ai`.

Gemini CLI setup includes portable `SessionStart`, `BeforeAgent`, `AfterTool`, and `AfterAgent` hooks for automatic scoped recall and capture. Other harnesses can feed exported transcripts through the generic ingestion surface:

```bash
pathmark ingest --client=claude-code --namespace=my-project < transcript.json
pathmark ingest --client=opencode --namespace=my-project < transcript.json
```

## Memory chat, consolidation, maintenance, and portable sync

Maintenance commands preview destructive changes unless `--apply` is present:

```bash
pathmark chat "What did we decide about release signing?" --namespace=my-project
pathmark consolidate --namespace=my-project
pathmark consolidate --namespace=my-project --cursor=LAST_RECORD_ID
PATHMARK_SYNTHESIS_PROVIDER=codex pathmark consolidate --namespace=my-project --apply
pathmark feedback --recall-id=RECALL_ID --relevant=MEMORY_ID --irrelevant=OTHER_ID
pathmark audit --days=30
pathmark audit --namespace=my-project --days=90
pathmark doctor
pathmark compact
pathmark compact --apply --retention-days=90
pathmark purge --namespace=old-client
pathmark purge --namespace=old-client --apply
```

`pathmark chat` and the MCP `chat` / `ask_memory` tools search approved conclusions first. Multi-intent questions can return separate conclusions for separate clauses. In default client mode, approved conclusions produce a safe extractive `answer`; a configured `codex`, `command`, or `openai-compatible` provider can synthesize richer prose. Raw fallback requires an explicit scope (`--namespace` / tags) or `kind: memory`, preventing unscoped cross-workspace history from entering chat.

Every matched chat query records recall activity and returns a `recallId` when the store is writable. Abstentions and read-only stores return `recallId: null`. Use MCP `rate_recall` or `pathmark feedback` with exact recalled IDs to label relevance. `pathmark audit` reports `precision.status: "labeled"`, measured precision, and label coverage once feedback exists.

`pathmark consolidate` is preview-first. With default client synthesis it returns the bounded evidence and exact instructions for the host agent, which can call `create_conclusion` with supporting `evidenceIds`. When more eligible evidence remains, the result includes `nextCursor` and `remainingAfterBatch`; pass the cursor to review the next stable page. With a configured server-side synthesis provider, it previews structured candidates; `--apply` stages them as pending conclusions for `approve_conclusion` or `reject_conclusion`. It never auto-approves extracted intent.

Applied compaction and purge create a backup before replacing the canonical file. Soft deletion remains available through `delete_memory`; hard purge physically removes selected records from JSONL and rebuilds the derived index.

`pathmark audit` is read-only. It separates all raw records from consolidation-eligible user/assistant evidence, then reports capture-to-recall ratio, actionable synthesis backlog, recall age, exact duplicates, stale raw hits, and scope/missing-reference signals. Precision remains `unlabeled` until explicit feedback exists; Pathmark never substitutes a heuristic for a user label.

Use scoped exports and merge imports as the transport-neutral sync layer:

```bash
pathmark export --namespace=my-project --output=project.jsonl
pathmark import project.jsonl --namespace=my-project
```

For an encrypted portable bundle, configure the passphrase outside the command line:

```bash
PATHMARK_EXPORT_KEY='use-a-secret-manager' pathmark export --encrypted --output=project.pathmark
PATHMARK_EXPORT_KEY='use-a-secret-manager' pathmark import project.pathmark
```

Pathmark does not silently upload these files. Move them through a trusted filesystem, backup tool, or sync provider of your choice.

## Optional hybrid retrieval

Default retrieval stays local SQLite FTS. To enable semantic or embedding-backed reranking without forcing a model dependency, set `PATHMARK_RERANK_COMMAND` to a trusted local command. It receives one JSON object on stdin containing `query` and `candidates`, and must return a JSON array of ranked record ids (or `{ "ids": [...] }`). If it fails or times out, Pathmark falls back to lexical results.

## Data Format

Pathmark stores newline-delimited JSON at:

```text
~/.pathmark/memory/memory.jsonl
```

`memory.jsonl` remains the canonical source of truth. Pathmark also maintains a derived, disposable search index at `memory.index.v5.sqlite`. Index filenames are schema-versioned so old and new MCP processes can coexist during a rolling restart. The index is rebuilt automatically when the JSONL file changes outside Pathmark, and inactive index versions can be deleted safely after their processes stop.

Each record is inspectable:

```json
{
  "id": "uuid",
  "kind": "memory",
  "text": "The user prefers local-first tools.",
  "tags": ["preference"],
  "source": "mcp",
  "createdAt": "2026-06-29T00:00:00.000Z",
  "updatedAt": "2026-06-29T00:00:00.000Z"
}
```

Deletes are soft deletes by default: the record gets a `deletedAt` timestamp. Use preview-first `purge_memory` or `pathmark purge --apply` for physical erasure. Updates preserve up to 50 prior versions, superseded records link to their replacement, and expired records are excluded from recall. The raw automatic-recall horizon is separate from storage retention: evidence can age out of proactive injection while remaining explicitly searchable.

Malformed JSONL lines are skipped rather than crashing every tool. `pathmark codex status` reports their count as `invalidRecordCount` so the source file can be repaired deliberately.

## Roadmap

- Provider presets for common local AI CLIs where stable commands exist.
- Encrypted store option.
- Hosted sync as an opt-in layer, not a requirement.
- Native auto-capture packages for additional harness plugin systems beyond Codex and Gemini CLI.
- Example recipes for Codex, Claude Desktop, Cursor, ChatGPT, and local LLM tools.

## Positioning

Pathmark gives your agents a shared working memory that stays on your machine.

> Switch agents. Keep the context.

> Bring your own subscription. Keep your memory local.

## Author and citation

Pathmark is created and maintained by [Sergey Moloman](https://rflxai.com/founder/sergey-moloman), a B2B AI integration specialist and private AI contractor, and founder of [RFLX AI](https://rflxai.com/).

Machine-readable authorship and citation metadata are available in [`CITATION.cff`](CITATION.cff) and [`codemeta.json`](codemeta.json).

## License

MIT
