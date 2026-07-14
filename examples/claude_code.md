# Claude Code Setup

Install:

```bash
npm install -g pathmark
```

Register the MCP server:

```bash
claude mcp add pathmark -- pathmark
```

Generate this snippet from the installed CLI:

```bash
pathmark setup claude-code
```

Use the same `PATHMARK_STORE_DIR` as your other harnesses when you want shared memory.

Ask Claude Code to call `recall_memory` at task start when you want a visible list of exactly which Pathmark memories it used.

To import an exported Claude transcript into the same namespace:

```bash
pathmark ingest --client=claude-code --namespace=my-project < transcript.json
```
