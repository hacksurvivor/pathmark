# Codex Setup

Install:

```bash
npm install -g pathmark
```

Register the MCP server:

```bash
codex mcp add pathmark -- pathmark
```

Enable Codex auto-capture hooks:

```bash
pathmark codex install --replace-legacy-hooks
```

The hooks capture prompts, tool summaries, and transcripts. They also recall relevant memory automatically at session start/resume and before non-trivial prompts. Set `PATHMARK_CODEX_PROACTIVE_RECALL=off` to keep capture on but disable prompt-time recall.

Check status:

```bash
pathmark codex status
```

Optional local store override:

```bash
codex mcp add pathmark --env PATHMARK_STORE_DIR=~/.pathmark/memory -- pathmark
```

Use the MCP tools from Codex:

- `remember`
- `search_memory`
- `recall_memory`
- `get_context`
- `create_conclusion`
- `ask_memory`

Use `recall_memory` when you want the visible entry showing exactly which memories were used.
