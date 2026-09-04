# Compatibility

Pathmark runs as a stdio MCP server. If a host can launch `pathmark` and speak MCP over stdin/stdout, it can use the same memory file.

Runtime requirement: Node.js 22.5 or newer. CI verifies current Node.js 22 and 24 releases.

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

- `remember` to save raw searchable evidence.
- `create_conclusion` to propose a higher-signal durable decision, preference, constraint, or insight.
- `consolidate_memory` to review bounded raw evidence and create evidence-backed, approval-gated conclusion candidates.
- `recall_memory` to recover relevant context and show exactly which memory IDs, timestamps, sources, and matches were used.
- `session_trace` to inspect the bounded chronological prompt, injected-memory, tool-result, and answer trail for one captured session.
- `search_memory` and `get_context` to recover relevant context.
- `ask_memory` to retrieve context and optionally synthesize an answer.
- `chat` to ask conclusions first and use raw evidence only as an explicit fallback.

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
| Gemini CLI | stdio MCP server + portable hooks | `pathmark setup gemini-cli --json` includes automatic scoped recall and prompt/response/tool capture hooks. |
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

Codex hooks inject memory automatically at session start/resume and before non-trivial prompts. Prompt-time recall is scoped to the current workspace or session, filters low-relevance and near-duplicate results, and only injects matching memories. This proactive context is quiet by default: it does not add a raw `recall_memory` result to the conversation. Set `PATHMARK_CODEX_VISIBLE_RECALL=on` for audit/debug sessions; Pathmark then asks Codex to call scoped visible recall with the exact pre-capture memory IDs, using `includeRecords: false` to avoid duplicating full text. You can also call it directly without `ids` for a fresh search:

```text
mcp__pathmark__recall_memory
```

Visible recall is deliberately a pre-answer memory snapshot. Later shell commands and results belong to a separate audit surface:

```text
mcp__pathmark__session_trace {"sessionId":"<exact-session-id>"}
```

Codex `PostToolUse` and `PostToolUseFailure` hooks store structured, redacted activity when the host supplies it: command/input preview and hash, status, exit code, duration, output hash, and changed files. Output text is private by default; set `PATHMARK_CODEX_CAPTURE_TOOL_OUTPUTS=on` to retain a redacted preview capped at 2,000 characters. Activity expires after 30 days and is capped at 5,000 physical records by default. Stop or PreCompact writeback stores user turns and `final_answer` messages, not intermediate commentary. Existing cursors migrate once without duplicating previously captured user or final-answer turns; exact legacy commentary records are recoverably soft-deleted when their transcript phase, timestamp, and text match.

Prompt-time recall searches the current workspace first and then a global fallback. Records whose project or namespace tag matches a named query term are preferred. Exact-ID visible recall omits the current workspace tag when the selected evidence legitimately spans projects. Session-start and prompt-time selection suppress legacy transport envelopes and assistant progress updates, while explicit `search_memory` calls can still find non-deleted raw records. Transcript ingestion unwraps `# Files mentioned`, `# Response annotations`, and `# Diff comments` envelopes to retain only the actual `My request for Codex` body and skips injected plugin, goal, and subagent context.

Optional Codex-backed synthesis works when the MCP client cannot synthesize and Codex CLI has local auth:

```bash
PATHMARK_SYNTHESIS_PROVIDER=codex
PATHMARK_CODEX_COMMAND=codex
PATHMARK_CODEX_MODEL=gpt-5.5
```

Use persisted Codex CLI auth. Pathmark deliberately does not forward arbitrary environment secrets such as API keys into the isolated synthesis process.

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

Generate the combined MCP and automatic-hook configuration:

```bash
pathmark setup gemini-cli --json
```

The generated `SessionStart`, `BeforeAgent`, `AfterTool`, and `AfterAgent` entries use Gemini CLI's stdin/stdout hook contract. They call `pathmark hook ...`, inject scoped memory as `additionalContext`, and capture prompt, response, and bounded structured tool records locally when the hook payload includes results.

For MCP-only operation, use the same local stdio shape:

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

## Transcript ingestion for other harnesses

When a harness exposes transcripts but does not have a stable command-hook contract, import its JSON message array through the generic adapter:

```bash
pathmark ingest --client=claude-code --namespace=my-project < transcript.json
pathmark ingest --client=opencode --namespace=my-project < transcript.json
```

Each message may contain `role` plus `text` or `content`, with optional `session_id`, `sessionId`, `createdAt`, or `timestamp`. Ingestion is redacted and exact-deduplicated by default. Use `--dry-run` to validate the record count without writing.

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
