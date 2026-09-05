# Decision assurance preview — validation

Validated September 5, 2026 on branch `codex/decision-assurance`, based on main commit `7094d52b6d68bc7d290cd3f1f02337067e74f501` (v0.1.15). This is an unreleased source preview. The globally installed package has not been replaced, and nothing has been pushed or published.

## What is implemented

All six reproduced defects have regression coverage: revision-bound approval, isolation of identically named projects, inherited evidence scope, bounded paraphrase/Russian retrieval and scored semantic reranking, evidence fallback per question intent, and project selection before snapshot budgeting.

The lifecycle now includes persistent evidence dispositions, a small review queue, exposure IDs and audit accounting. Typed decisions retain rationale, alternatives, assumptions, checks, an owner, source evidence and an optional review date. A task brief returns exact approved revisions. Checking explicit plan facts returns pass, conflict or unknown; stale evidence and changed assumptions trigger reconsideration. Outcomes remain attached to the exact check.

The CLI uses the existing JSON conventions. It does not parse arbitrary diffs into reliable facts or execute commands stored in memory. The model or caller supplies plan facts, so false or incomplete facts remain an explicit limitation. See the [workflow](../decision-workflow.md).

## Verification

| Check | Observed result |
| --- | --- |
| `npm test` | Build, all 14 runtime scripts, and ESLint passed. |
| New decision regression script | 13 scenarios passed through real MCP connections, CLI calls, hooks and disposable stores. |
| `npm run coverage` | 92.08% statements/lines, 80.42% branches, 97.50% functions; configured gates passed. |
| Dependency audit | `npm ci --ignore-scripts` and `npm audit --audit-level=moderate`: zero vulnerabilities reported. |
| `npm pack --dry-run --json` | Build passed; new compiled modules included; no memory stores or validation fixture data in package. |
| Two-client MCP handoff | Passed: proposal, exact-revision review, independent-client recovery, conflict/pass/unknown, changed assumption, feedback. These clients are protocol drivers, not two models. |
| Two fresh model sessions using MCP | **Blocked** at authoring: automatic approval review rejected `remember` because approval was required while the runner's approval policy was `never`. No persisted proposal or second-model handoff was verified. |

The optional `scripts/model-handoff.mjs` canary now saves failures/blocks as explicit reports and exits unsuccessfully. Its approval policy remains unchanged. The blocked attempt is recorded in [model-handoff.json](model-handoff.json). It is not part of the passing offline test suite.

## Controlled benchmark

Forty synthetic decision judgments, with ordinary wording, paraphrases, Russian, absent facts, wrong types, changed assumptions and unrelated tasks:

| Condition | Correct judgments |
| --- | ---: |
| No additional memory | 20 / 40 |
| Installed v0.1.15 Pathmark baseline | 30 / 40 |
| Curated instructions | 40 / 40 |
| New decision checks | 40 / 40 |

The deterministic checker also passed 40/40, with p95 approximately 10 ms in the latest local run. [Model results](decision-benchmark-model.json) and [local results](decision-benchmark-local.json) include individual outcomes and timing where available.

This is one batched model call per condition, not 40 completed coding tasks. The decision-check condition supplies checker findings to the model, so that condition measures consumption of those findings. The exact CLI-default model identifier was not captured. The dataset was authored for this feature and is not an independent held-out evaluation. These results support the bounded retrieval/check behavior and establish no advantage over curated instructions, no correction-rate reduction, and no market uniqueness.

## Work that remains

Verify the actual model-to-model handoff in a context that permits the requested synthetic writes. Then run the [two-week pilot](../decision-pilot.md) with consenting participants and fixed model versions, measuring completed tasks, repeated corrections, stale-memory errors and review effort. No participants have been recruited, messages sent, or user study completed. Publishing, shared installation and a broad product pivot remain separate decisions.
