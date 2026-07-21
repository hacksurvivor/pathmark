# Security Policy

Pathmark is local-first memory infrastructure. The default store is a JSONL file on your machine:

```text
~/.pathmark/memory/memory.jsonl
```

## Supported Version

Pathmark is currently pre-1.0. Security fixes are handled on `main` and released as matching GitHub and npm versions.

## Data Model

- Core memory tools do not require an API key or hosted account.
- The default synthesis mode is `client`; the MCP client model reads retrieved memory context.
- `openai-compatible`, `command`, and `codex` synthesis modes are opt-in.
- Deletes are soft by default. `purge_memory` and `pathmark purge --apply` physically remove selected records and rebuild the derived index after creating a backup.
- `memory.index.v*.sqlite` files are derived local search indexes and contain the same memory text as the canonical JSONL store. Protect them with the same filesystem controls.
- Codex and portable-hook auto-capture, MCP writes, imports, and transcript ingestion redact common secret-shaped values, credential URLs, bearer tokens, OpenAI keys, PEM private keys, and quoted secret assignments before storage by default. `PATHMARK_REDACT_MCP_WRITES=off` is an explicit opt-out.
- Tool-result text is not stored by default. `PATHMARK_CODEX_CAPTURE_TOOL_OUTPUTS=on` explicitly opts into bounded, redacted output previews; hashes, status, duration, and exit codes remain available without the preview. Heuristic redaction cannot guarantee removal of arbitrary PII or proprietary text.
- Codex transcript capture stores user requests and final answers, excluding intermediate assistant commentary and injected plugin/goal/subagent payloads. File, annotation, and diff envelopes are reduced to their explicit `My request for Codex` body. On cursor migration, legacy commentary is soft-deleted only when transcript phase, timestamp, and redacted text all match; unmatched legacy records remain until normal retention or explicit purge. Session-start and proactive relevance selection suppress common progress updates and transport envelopes.
- Recall and tool activity records expire after 30 days and are physically capped at 5,000 records by default. Configure `PATHMARK_ACTIVITY_RETENTION_DAYS` and `PATHMARK_ACTIVITY_MAX_RECORDS` for stricter local policy.
- Portable exports can be encrypted with AES-256-GCM using `PATHMARK_EXPORT_KEY`. The passphrase is never returned by `get_config`, but environment and key management remain the user's responsibility.
- The canonical store and derived index are not application-encrypted at rest. Use operating-system disk encryption and filesystem permissions when the machine or backup medium is not already protected.
- Codex-backed synthesis treats memory as untrusted data, passes prompts over stdin, uses an empty temporary workspace, and strips arbitrary environment variables. It requires persisted Codex CLI authentication rather than an API key inherited through the environment.

## Sensitive Data Guidance

- Treat `~/.pathmark/memory/memory.jsonl` as private working data.
- Treat `~/.pathmark/memory/memory.index.v*.sqlite` and its temporary SQLite files as equally private.
- Back it up and sync it only through systems you trust.
- Review records before sharing logs, bug reports, or screenshots.
- Use `delete_memory` for reversible removal and preview-first `purge_memory` for verified physical erasure. Applied purge and compaction report the backup path.
- Treat configured reranking commands as trusted local processors: candidate memory text is sent to them over stdin when `PATHMARK_RERANK_COMMAND` is enabled.

## Reporting a Vulnerability

Please report security issues privately through [GitHub private vulnerability reporting](https://github.com/hacksurvivor/pathmark/security/advisories/new). If that form is unavailable, contact the [maintainer through GitHub](https://github.com/hacksurvivor).

Include:

- Affected version or commit.
- Reproduction steps.
- Whether local memory, hook config, command execution, or remote synthesis is involved.
- Any suspected exposure path, without including real secrets.

Please do not post working exploits or sensitive memory contents in public issues.
