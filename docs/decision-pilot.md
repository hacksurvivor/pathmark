# Decision-check pilot kit

Purpose: decide whether Pathmark reduces repeated corrections enough to justify a broader product direction. This is a plan and measurement kit, not a completed user study.

## Participants and scope

Start with five consenting people who already switch between at least two coding agents on ongoing projects. Use one chosen project per person for two weeks. Keep all memory local. Do not collect full transcripts, customer data, or source code for study reporting; export reviewed aggregate observations only. No invitations have been sent and no recurring monitoring has been created.

Before enabling the development build on a real memory store, make a backup, verify the selected store path, and use the same Pathmark build in every participating harness. Do not bridge the former Honcho store. First run the isolated demo and verify both configured clients use the intended project identity.

## First session

1. Identify one correction the participant has had to repeat.
2. Capture its source evidence and propose at most three decisions, preserving why each exists and when it should be reconsidered.
3. Let the participant approve, edit, or dismiss the proposals. Record review minutes.
4. Open the second agent. Ask it to inspect a task brief and check the planned change against applicable decisions.
5. Ask whether the intervention was useful, irrelevant, or stale; record its exact check ID.

This is a moderated trial. Do not silently seed rules that the participant has not approved. Do not deliberately let a conflict produce an external side effect.

## Comparison

Pair similar tasks or use randomized task assignment to:

- No added memory, with normal repository instructions retained.
- A carefully curated repository instruction file containing the same decisions and rationale.
- Published Pathmark baseline with equivalent approved content.
- Decision checks with explicit plan facts and recorded outcomes.

Hold model, available tools, repo starting state, and budget fixed. Record model/version explicitly. Counterbalance order to reduce learning effects, and keep source evidence equally available. Blind the final task reviewer to the condition where practical. Include normal lexical prompts as well as paraphrases, language switches, stale assumptions, missing facts, and unrelated projects. Do not infer savings from a benchmark that only asks the model to repeat a checker label.

## Per-task record

A JSONL row can use:

```json
{
  "taskId": "anonymous-task-001",
  "participantId": "p1",
  "condition": "decision-checks",
  "model": "exact-model-id",
  "harness": "exact-client-version",
  "commit": "starting-revision",
  "completed": true,
  "accepted": true,
  "avoidableRepeatedCorrections": 0,
  "newMemoryCausedErrors": 0,
  "falseAlarms": 0,
  "missedApplicableDecisions": 0,
  "reviewMinutes": 1.5,
  "addedLatencyMs": 0,
  "addedInputTokens": 0,
  "checkIds": [],
  "note": "Reviewed aggregate note without private content"
}
```

Define an avoidable repeated correction before scoring: an earlier approved, still-applicable decision existed, the task required it, and the user had to restate or correct the same point. A changed requirement is not a repeated mistake. Track incorrectly applying stale decisions separately.

## Proposed continuation gate

- At least 30% fewer avoidable repeated corrections than the curated-instruction condition.
- No material reduction in accepted task success or increase in memory-caused errors.
- Low false-alarm and human-review burden.
- Participants voluntarily repeat the handoff workflow.
- Willingness to pay is asked after demonstrated value, not inferred from downloads or enthusiasm.

These are decision thresholds, not claims of statistical significance. Five participants and a short pilot cannot establish a broad market result. Report denominators and uncertainty, and retain negative outcomes. If the curated file performs as well with less effort, simplify Pathmark rather than adding a larger platform.

## Local benchmark

```bash
npm run benchmark:decisions -- --output=docs/validation/decision-benchmark-local.json
node scripts/benchmark-decisions.mjs --model-eval --baseline=/path/to/built/baseline --output=docs/validation/decision-benchmark-model.json
```

Default mode runs 40 deterministic fixture checks locally. Model mode additionally makes four batched Codex CLI inference calls using existing authentication, with hooks/memory/user configuration disabled by the existing synthesis isolation. It sends synthetic fixtures only. Review model usage before choosing repeated runs. The exact CLI-default model identifier is not currently captured; this limits reproducibility and must be supplied explicitly in a real pilot.

The fixture benchmark measures controlled decision judgments. It does not measure completed coding tasks, repeated user corrections, retention, willingness to pay, or end-to-end safety. The `decision-checks` model condition includes checker findings, so it tests faithful use of those findings, not independent discovery of the decisions.
