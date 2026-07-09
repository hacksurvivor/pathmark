# Compatibility

Pathmark runs as a stdio MCP server. If a host can launch `pathmark` and speak MCP over stdin/stdout, it can use the same memory file.

Use one memory store across Codex, Claude Code, opencode, Gemini CLI, OpenClaw, Hermes Agent, Cursor, and other MCP-capable clients.

## The Core Contract

Install:

```bash
npm install -g pathmark
```

MCP server command:

```bash
pathmark
```

Recommended env:

```bash
PATHMARK_STORE_DIR=~/.pathmark/memory
PATHMARK_SYNTHESIS_PROVIDER=client
```

With `client`, the MCP host's model reads the returned memory context and writes the answer. Use this default for Codex, Claude Code, opencode, Gemini CLI, Hermes Agent, OpenClaw, Grok-compatible clients, Cursor, and Claude Desktop.

Use the same `PATHMARK_STORE_DIR` in every harness when you want shared context across tools.

```text
~/.pathmark/memory/memory.jsonl
```

That file holds the shared memory. Each harness can call the same tools:

- `remember` to save a fact, decision, preference, or project note.
- `create_conclusion` to save a higher-signal durable insight.
- `recall_memory` to recover relevant context and show exactly which memory IDs, timestamps, sources, and matches were used.
- `search_memory` and `get_context` to recover relevant context.
- `ask_memory` to retrieve context and optionally synthesize an answer.

Pathmark provides the shared store and MCP tool surface today. `recall_memory` is the portable visible recall surface across Codex, Claude Code, Cursor, opencode, Gemini CLI, Grok-compatible MCP hosts, Hermes Agent, OpenClaw, Kimi/GLM hosts, and generic MCP clients. Harness-specific hooks and importers add automatic transcript capture where the host supports it.

## Generate Setup Snippets

The installed CLI can print setup instructions for common harnesses:

```bash
pathmark setup list
pathmark setup codex
pathmark setup claude-code
pathmark setup opencode
pathmark setup gemini-cli
pathmark setup generic --json
pathmark setup kimi --json
```

Use `--json` when another installer or script should consume the output.

## Client Matrix

| Client or model surface | Pathmark integration | Notes |
| --- | --- | --- |
| Codex | stdio MCP server | Use `codex mcp add pathmark -- pathmark`. Optional `codex` synthesis preset. |
| Claude Code | stdio MCP server | Add as a local stdio MCP server. Keep synthesis as `client`; call `recall_memory` for visible used-memory entries. |
| Claude Desktop | stdio MCP server | Use `mcpServers.pathmark.command = "pathmark"`. |
| Cursor | stdio MCP server | Add `pathmark` to Cursor MCP settings; call `recall_memory` for visible used-memory entries. |
| opencode | stdio MCP server | Add Pathmark as a local MCP server command; call `recall_memory` for visible used-memory entries. |
| Gemini CLI | stdio MCP server | Add Pathmark to Gemini CLI MCP server settings; call `recall_memory` for visible used-memory entries. |
| Hermes Agent | stdio MCP server if MCP is enabled | Add Pathmark to the agent's MCP server list; keep memory local in `~/.pathmark`; call `recall_memory` for visible used-memory entries. |
| OpenClaw | stdio MCP server if MCP tools are enabled | Register Pathmark as a local MCP tool server; call `recall_memory` for visible used-memory entries. |
| Grok CLI / Grok Build | stdio MCP server when supported by the harness | If the Grok surface has MCP config, add Pathmark as a stdio server. Otherwise use `command` mode. |
| Kimi models | MCP through a host, or `openai-compatible` / `command` synthesis | The agent harness provides MCP for raw models; use `recall_memory` in that host for a visible memory trace. |
| GLM / Z.ai models | MCP through a host, or `openai-compatible` / `command` synthesis | Use an MCP-capable client, API gateway, or local CLI; use `recall_memory` in that host for a visible memory trace. |
| Local models | MCP through a host, or `command` / `openai-compatible` synthesis | Works with Ollama/LiteLLM/local routers when exposed through CLI or compatible API. |

## Generic MCP Config

Most clients use a shape like this:

```json
{
  "mcpServers": {
    "pathmark": {
      "command": "pathmark",
      "env": {
        "PATHMARK_STORE_DIR": "~/.pathmark/memory",
        "PATHMARK_SYNTHESIS_PROVIDER": "client"
      }
    }
  }
}
```

If a client uses `command` plus `args`, use:

```json
{
  "command": "pathmark",
  "args": [],
  "env": {
    "PATHMARK_STORE_DIR": "~/.pathmark/memory",
    "PATHMARK_SYNTHESIS_PROVIDER": "client"
  }
}
```

## Codex

```bash
codex mcp add pathmark -- pathmark
```

Enable auto-capture hooks:

```bash
pathmark codex install --replace-legacy-hooks
```

This removes old compatible hook commands from Codex without deleting memory files.

Codex hooks inject memory automatically at session start/resume and before non-trivial prompts. Prompt-time recall is scoped to the current workspace or session and only injects matching memories. When you want a visible tool-call entry that shows exactly which memories were used, call:

```text
mcp__pathmark__recall_memory
```

Optional Codex-backed synthesis works when the MCP client cannot synthesize and Codex CLI has local auth:

```bash
PATHMARK_SYNTHESIS_PROVIDER=codex
PATHMARK_CODEX_COMMAND=codex
PATHMARK_CODEX_MODEL=gpt-5.5
```

## Claude Code

```bash
claude mcp add pathmark -- pathmark
```

Recommended config:

```json
{
  "mcpServers": {
    "pathmark": {
      "command": "pathmark",
      "env": {
        "PATHMARK_SYNTHESIS_PROVIDER": "client"
      }
    }
  }
}
```

## opencode

Register Pathmark as a local MCP server command:

```json
{
  "mcp": {
    "pathmark": {
      "type": "local",
      "command": ["pathmark"],
      "enabled": true,
      "environment": {
        "PATHMARK_SYNTHESIS_PROVIDER": "client"
      }
    }
  }
}
```

## Gemini CLI

Add Pathmark to Gemini CLI's MCP server settings using the same local stdio shape:

```json
{
  "mcpServers": {
    "pathmark": {
      "command": "pathmark",
      "args": [],
      "env": {
        "PATHMARK_SYNTHESIS_PROVIDER": "client"
      }
    }
  }
}
```

## Hermes Agent / OpenClaw / Grok-Compatible Harnesses

If the harness supports MCP, add Pathmark as a local stdio MCP server:

```json
{
  "name": "pathmark",
  "command": "pathmark",
  "args": [],
  "env": {
    "PATHMARK_STORE_DIR": "~/.pathmark/memory"
  }
}
```

Harnesses with a local CLI can use command synthesis from another MCP client:

```bash
PATHMARK_SYNTHESIS_PROVIDER=command
PATHMARK_CHAT_COMMAND="your-agent-cli chat --model your-model"
```

`PATHMARK_CHAT_COMMAND` receives the memory prompt on stdin and should write the answer to stdout.

## Kimi / GLM / Other OpenAI-Compatible Models

Use an MCP-capable client when possible. Raw model APIs do not call MCP tools by themselves; the harness provides that tool loop. If you want Pathmark's `ask_memory` tool to synthesize directly through a compatible model endpoint:

```bash
PATHMARK_SYNTHESIS_PROVIDER=openai-compatible
PATHMARK_OPENAI_BASE_URL=https://api.provider.example/v1
PATHMARK_OPENAI_API_KEY=...
PATHMARK_OPENAI_MODEL=...
```

This is provider-neutral. It calls `POST /chat/completions` and parses `choices[0].message.content`.

## Boundaries

- Pathmark expects the host or harness to provide MCP.
- Raw models need an MCP-capable harness, a local CLI, or an OpenAI-compatible endpoint.
- Memory save, search, and context tools work without a cloud account or model API key.
