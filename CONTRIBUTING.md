# Contributing

Pathmark Memory is intentionally small and local-first.

## Development

```bash
npm install
npm test
npm run coverage
```

## Design Rules

- Keep the default path local and inspectable.
- Do not require hosted auth for core memory tools.
- Keep MCP tool outputs structured and readable.
- Prefer migrations over hidden format changes.
- Add smoke coverage for new MCP tools.
- Keep lint and coverage gates passing on Node.js 22 and 24.

## Pull Requests

Include:

- What changed.
- How it was tested.
- Any data format or compatibility impact.
