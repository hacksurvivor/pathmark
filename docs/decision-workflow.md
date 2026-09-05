# Decision checks — development preview

Pathmark can carry an approved decision into another coding agent, explain why it exists, compare explicit plan facts with its requirements, and identify assumptions that need reconsideration.

This is an unreleased feature on the decision-assurance branch. The published 0.1.15 package does not include these commands. Build this checkout with `npm ci` and `npm run build`; use `node dist/index.js` in place of `pathmark` below until installing a reviewed release. Keep all clients on the same version before using the new metadata in a shared store. Older clients may discard fields they do not understand.

## Try a complete isolated handoff

```bash
npm run demo:handoff
```

The demo starts two independent MCP server/client connections, proposes and approves a synthetic local-storage decision, and demonstrates conflict, pass, changed assumptions, missing facts, and feedback. It removes its temporary store. It does not read your canonical memory or contact clients. The two clients are protocol clients, not two autonomous models.

## Set project identity

```bash
pathmark project
pathmark project init
```

Without a configuration file, a Git repository and its worktrees share an identity derived from the canonical Git common directory. Non-Git directories use their canonical path. `project init` creates `pathmark.project.json` with a persistent ID. Keep this small file with the project so moving or cloning it preserves identity. For an intentional second checkout of the same project, copy the file or initialize it with `--id=EXISTING_ID`. It contains no memory or credentials.

A folder name is a display label. Two unrelated directories called `app` no longer share proactive memory. Legacy records with only `project:app` remain explicitly searchable but are not automatically treated as the current workspace. Existing workspace-tagged records remain eligible in that exact workspace; Git root/worktree aliases permit the repository's existing root records. No canonical records are rewritten or migrated automatically.

## Review a small batch

```bash
pathmark review --tag=project:my-project --limit=3
```

The existing JSON CLI format shows pending conclusions, source excerpts, and revision IDs. With no explicit tag or namespace, the new decision/review commands use the current stable project ID. MCP clients should pass the same `project-id:...` tag shown by `pathmark project`, or an explicitly chosen namespace.

Evidence that contains no durable lesson can be dismissed without manufacturing a conclusion:

```bash
pathmark review evidence --id=EVIDENCE_ID --revision=REVISION_HASH --status=temporary --by=me
```

Other dispositions are `duplicate`, `incorporated`, `rejected`, and `needs-review`. Editing the source invalidates its disposition and reopens review. A stale revision cannot dismiss newly edited text. The record remains in the searchable archive.

## Propose a decision

Use `remember` through MCP, or the existing scoped transcript ingestion, to capture supporting evidence first. Then pass a JSON document to `pathmark decision propose --tag=project:my-project`, or use `create_conclusion` with the same `decision` field:

```json
{
  "text": "Customer transcripts remain local.",
  "evidenceIds": ["EXISTING_EVIDENCE_ID"],
  "decision": {
    "owner": "Project owner",
    "rationale": "Customer consent currently covers local processing only.",
    "alternatives": ["Hosted transcription was rejected under this consent."],
    "assumptions": [
      {
        "field": "consent",
        "operator": "eq",
        "value": "local-only",
        "explanation": "Consent covers local processing only."
      }
    ],
    "checks": [
      {
        "field": "transcriptStorage",
        "operator": "eq",
        "value": "local",
        "explanation": "Hosted storage conflicts with the approved consent boundary."
      }
    ]
  }
}
```

The supporting evidence must exist in the selected scope. Rules compare named primitive facts using `eq`, `neq`, `includes`, `not-includes`, `lte`, or `gte`. Rules never execute commands. An optional `reviewAfter` ISO timestamp can require reconsideration after a date.

Review and approve the returned revision:

```bash
pathmark review --tag=project:my-project
pathmark review approve --id=PROPOSAL_ID --revision=REVISION_HASH --by=me
```

Approval binds the text, scope tags, decision details, evidence IDs, source, and expiry. The approval also records supporting evidence revisions. Material edits to an approved conclusion create a pending replacement; the old approved record stays active until the replacement is approved. Competing replacements cannot revive a superseded original. A `decidedBy` label records attribution; it is not authentication or proof of human authorization.

## Hand off and check a plan

In the next agent, call `task_brief` with the project scope. It returns approved decisions, rationale, assumptions, required fact fields, evidence, and exact revisions. Decision-aware startup snapshots point the agent to this workflow; they do not automatically extract or verify plan facts.

```bash
pathmark decision brief --tag=project:my-project
pathmark decision check --tag=project:my-project < plan.json
```

Example plan document:

```json
{
  "plan": "Use a hosted transcription provider.",
  "facts": { "consent": "local-only", "transcriptStorage": "cloud" }
}
```

The result is `conflict`. With local storage it is `pass`. If consent has changed it is `unknown` with `reconsider: true`. If required facts are absent or have incompatible types it is `unknown`. Changed, deleted, expired, or unbound supporting evidence also prevents a pass.

The agent or user supplies facts based on the proposed plan or inspected diff. These facts are assertions, not independent verification of repository or production state. Prose is included for context; the checker does not claim to understand every natural-language plan. A pass covers the supplied facts and applicable checks only. It does not authorize sending, calling, deploying, or modifying external systems. Current user and repository instructions remain authoritative.

Complete decisions are subject to a context budget. If some cannot fit, the result reports truncation and cannot claim a complete pass.

## Record whether it helped

```bash
pathmark decision outcome --check-id=CHECK_ID --outcome=useful
```

Other outcomes: `false-alarm`, `missed-conflict`, `decision-changed`, and `no-effect`. Outcomes retain the checked revisions. `pathmark audit` reports retained checks and labels alongside memory metrics. Labels are observations, not proof of causally improved productivity. Review duplicates or subsequent label changes before interpreting aggregate counts.

Explicit recall now returns a `recallId` for `rate_recall`; startup snapshot and task-brief exposures are also recorded. Audit and export use the same inherited scope semantics as chat. Activity retention can still shorten the observable period; compare first/last retained recall times with the requested audit window.

## Retrieval limits

The default local expansion supports a bounded vocabulary of related English/Russian terms for storage and a few common concepts. It is not a general multilingual embedding model. Existing exact/lexical retrieval remains available.

A configured reranker can return legacy ordered IDs, or calibrated scores:

```json
{"results":[{"id":"MEMORY_ID","score":0.93}]}
```

Scores must be finite numbers from 0 to 1. Scores of at least 0.8 can support semantic selection for the exact query ranked; unscored IDs affect ordering only. Low scores do not bypass lexical abstention. Scope filtering precedes this ranking in the shared context pipeline. Rerankers are explicitly configured programs and must have an appropriate data boundary; Pathmark does not install one automatically.

Multi-part questions allocate results per intent. Approved conclusions cover one part while labeled scoped raw evidence can cover another. Answers report uncovered intents rather than silently presenting a partial answer as complete.

## Integration coverage

- Codex hooks: automated capture, scoped startup context, prompt recall, and decision-workflow guidance; tested through actual hook entry points and fixture CLI processes.
- Gemini portable hooks: tested with protocol fixtures; this change was not tested in an installed Gemini application.
- Other MCP clients: share the decision tools; the two-client demo verifies independent MCP connections. This does not imply automatic capture or automatic checking in every advertised harness.
