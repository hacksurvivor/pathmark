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
- Deletes are soft deletes inside the JSONL store.
- `memory.index.sqlite` is a derived local search index and contains the same memory text as the canonical JSONL store. Protect both files with the same filesystem controls.
- Codex auto-capture redacts common secret-shaped values, credential URLs, bearer tokens, OpenAI keys, PEM private keys, and quoted secret assignments before storage, but users should still avoid pasting credentials into prompts.
- Codex-backed synthesis treats memory as untrusted data, passes prompts over stdin, uses an empty temporary workspace, and strips arbitrary environment variables. It requires persisted Codex CLI authentication rather than an API key inherited through the environment.

## Sensitive Data Guidance

- Treat `~/.pathmark/memory/memory.jsonl` as private working data.
- Treat `~/.pathmark/memory/memory.index.sqlite` and its temporary SQLite files as equally private.
- Back it up and sync it only through systems you trust.
- Review records before sharing logs, bug reports, or screenshots.
- Use `delete_memory` for targeted removal; manually inspect the JSONL file for high-risk cleanup.

## Reporting a Vulnerability

Please report security issues privately by opening a GitHub security advisory for this repository when available, or by contacting the maintainer directly through the GitHub profile.

Include:

- Affected version or commit.
- Reproduction steps.
- Whether local memory, hook config, command execution, or remote synthesis is involved.
- Any suspected exposure path, without including real secrets.

Please do not post working exploits or sensitive memory contents in public issues.
