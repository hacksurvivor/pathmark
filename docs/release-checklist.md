# Release Checklist

Use this before tagging or announcing a Pathmark release. npm publishing is performed only by the tag-triggered trusted-publishing workflow.

## Local verification

```bash
npm ci
npm test
npm run coverage
npm audit
npm pack --dry-run
```

Confirm the tarball includes the CLI, MCP server, Codex adapter, and importer, but excludes local memory, indexes, coverage output, and planning files.

## Version metadata

```bash
VERSION=$(node -p 'require("./package.json").version')
npm run release:verify -- --tag="v$VERSION"
git status --short
```

The package version, MCP server version, tag, and `docs/releases/v$VERSION.md` must match. Release from a clean commit on `main`.

## Live Codex verification

```bash
pathmark codex status
npm run canary:installed -- --session=<exact-session-id>
```

Expected fields:

```json
{
  "pathmarkHooksInstalled": true,
  "pathmarkMcpRegistered": true,
  "legacyHooksPresent": false,
  "invalidRecordCount": 0
}
```

Confirm the canonical store and derived index are present:

```bash
test -f ~/.pathmark/memory/memory.jsonl
test -f ~/.pathmark/memory/memory.index.v4.sqlite
```

## GitHub and npm release

The repository must have:

- protected `main` with required CI checks;
- protected `v*` tags;
- an `npm` deployment environment for the publish job;
- npm trusted publishing restricted to `.github/workflows/publish.yml`;
- traditional npm publish tokens disabled where account policy permits.

Create and push the matching tag. The tag starts the publish workflow:

```bash
VERSION=$(node -p 'require("./package.json").version')
git tag -s "v$VERSION" -m "Pathmark v$VERSION"
git push origin "v$VERSION"
gh run watch --exit-status
```

After the publish workflow succeeds, create the GitHub release from the committed notes:

```bash
gh release create "v$VERSION" \
  --title "Pathmark v$VERSION" \
  --notes-file "docs/releases/v$VERSION.md" \
  --verify-tag
```

Final verification:

```bash
npm view pathmark version dist-tags.latest gitHead dist.attestations --json
gh release view "v$VERSION"
```
