# Executed coding comparison — September 5, 2026

**No advantage demonstrated.** All three conditions passed all eight implementation tasks on the first attempt and after review. There were no initial failures for any condition to repair. The proposed 30% reduction in repeated corrections has not been established.

| Condition | Initial acceptance | Final acceptance | Failures repaired | New failures | Total prompt characters |
| --- | ---: | ---: | ---: | ---: | ---: |
| Curated instructions | 8/8 | 8/8 | 0 | 0 | 12,836 |
| Pathmark decisions | 8/8 | 8/8 | 0 | 0 | 39,923 |
| Curated instructions + same checks | 8/8 | 8/8 | 0 | 0 | 14,021 |

Pathmark used approximately 3.11 times the prompt characters of curated instructions. This is a payload-size measurement, not a token-cost estimate or latency regression. Total inference wall times were approximately 71.49 s, 63.16 s and 61.28 s respectively; one run per condition cannot establish a speed difference. CLI-reported token totals include runtime overhead and are retained as raw metadata, not claimed as marginal context cost.

## Method

The exact reported model was `gpt-6-astra`, with `codex-cli 0.153.4`. The first call used the CLI default and captured its model header; subsequent calls explicitly pinned that model. User configuration, hooks and memories were disabled, with a temporary read-only model working directory. Only synthetic task data was sent. The full run made six inference calls: an implementation batch and a review batch for each condition. Eight separate pure JavaScript functions were executed against fixed acceptance tests per condition. Every condition received the same underlying decisions, rationale, current requirements and two-call budget. Task order rotated by condition.

Acceptance tests and prompts were fixed before model execution; their SHA-256 hashes are in [protocol.json](protocol.json). Tests were withheld from both model calls. The generated functions ran locally in bounded VM contexts, with no external task side effects. The harness tested its mutation detection, timeout and prohibited-runtime checks before execution. Object key ordering does not affect acceptance. The runner is for these trusted synthetic evaluations; Node's VM is not a general hostile-code security boundary.

The tasks covered local transcript jobs, retry policy, private-field exclusion, integer money parsing, workspace isolation, changed database assumptions, Russian attachment requirements, and an explicit retention override. The last two changed-requirement cases tested resistance to stale memory. Final acceptance means passing these bounded fixtures, not proving production readiness.

Curated instructions received a self-review pass. Pathmark received checks of facts extracted by fixed probes from generated code, plus decision revisions and provenance. The third condition received the same predicate findings without Pathmark's provenance payload. This extra control distinguishes the benefit of executable checks from their memory packaging. It is a generous control that assumes equivalent checks already exist; their creation and maintenance effort was not measured. The Pathmark check calls were performed by the evaluation driver, not autonomously discovered by the model.

## Interpretation and limits

This small, authored dataset reached a ceiling. It does not show that the conditions are equivalent on harder tasks or long-running projects, and it provides no evidence of Pathmark superiority. The eight functions within a call share a model session, so they are not eight independent experimental runs. Condition order was fixed, no blind independent evaluator designed the tasks, and no confidence interval is meaningful here. No human participant performed these synthetic tasks; acceptance failures cannot be relabeled as repeated user corrections or review minutes.

The useful next evidence is prospective real work: does Pathmark recover a previously approved decision that the receiving agent would otherwise miss, without imposing more effort than a curated brief? The user selected the active co·od icon task, Mac implementation task, and Pathmark itself for a separate one-participant observation. Each has its own brief and event log. Private task history and stores remain outside this repository. It is not randomized; three tasks are not three independent participants. No causal comparison or willingness-to-pay result will be inferred from a single iteration. The initial Pathmark self-check recorded no-effect because the plan already followed the brief before exposure.

Preserve the reliability fixes. Keep the broader product pivot experimental. The current evidence argues for reducing brief overhead and measuring actual handoffs before adding more memory machinery.

## Reproduce

From a built source checkout:

```bash
node scripts/coding-pilot.mjs
node scripts/coding-pilot.mjs --run --model=gpt-6-astra --output=/path/to/new-result-directory
```

Model mode uses six inference calls through existing Codex authentication. Use a new output directory to preserve this frozen run. The default self-check makes no inference calls. [results.json](results.json) includes every initial/final acceptance outcome; the six adjacent condition files retain the synthetic prompts and generated code.
