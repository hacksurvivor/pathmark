import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureDecisions, decisionSpec, curatedText, benchmarkCases } from './decision-fixtures.mjs';
import { PathmarkStore, closeOpenStores } from '../dist/store.js';
import { loadConfig } from '../dist/config.js';
import { checkDecisions } from '../dist/decisions.js';
import { synthesizeWithCommand } from '../dist/chat.js';
const arg = (key) => process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const temp = await mkdtemp(path.join(os.tmpdir(), 'pathmark-benchmark-'));
const config = { ...loadConfig(), storeDir: temp, memoryFile: path.join(temp, 'memory.jsonl'), synthesisProvider: 'client' };
const store = new PathmarkStore(config);
let baselineClose;
try {
  const cases = benchmarkCases();
  for (const item of fixtureDecisions) {
    const evidence = await store.add({ kind: 'memory', text: curatedText(item), tags: [`project:${item.id}`, 'role-user'] });
    const proposal = await store.proposeConclusion({ id: item.id, text: item.text, decision: decisionSpec(item), evidenceIds: [evidence.id], tags: [`project:${item.id}`] });
    await store.decideConclusion(proposal.record.id, 'approved', { decidedBy: 'fixture-author' });
  }
  const actual = [];
  for (const entry of cases) {
    const start = performance.now();
    const check = await checkDecisions(store, config, { tags: [`project:${entry.unrelated ? 'unrelated' : entry.decisionId}`], facts: entry.facts, plan: entry.question });
    assert.equal(check.status, entry.status, entry.id);
    assert.equal(check.findings.some((finding) => finding.reconsider), entry.reconsider, entry.id);
    actual.push({ id: entry.id, status: check.status, reconsider: check.findings.some((finding) => finding.reconsider), ms: performance.now() - start, findings: check.findings });
  }
  const latencies = actual.map((item) => item.ms).sort((a, b) => a - b);
  const report = { generatedAt: new Date().toISOString(), kind: 'controlled-decision-judgment', cases: cases.length,
    deterministic: { correct: actual.length, p95Ms: latencies[Math.ceil(latencies.length * .95) - 1] },
    limitations: ['Synthetic cases test decision judgments, not completed coding tasks or real user correction rates.', 'The proposed 30% correction-reduction product gate requires an observed user/task pilot.'],
    modelEvaluation: null };
  if (process.argv.includes('--model-eval')) {
    const baseline = arg('baseline'); if (!baseline) throw new Error('--model-eval requires --baseline=PATH to a built baseline installation');
    const { PathmarkStore: BaselineStore, closeOpenStores: closeBaseline } = await import(pathToFileURL(path.join(baseline, 'dist/store.js')));
    const { relevantMemorySearch: baselineSearch } = await import(pathToFileURL(path.join(baseline, 'dist/memory-query.js')));
    baselineClose = closeBaseline;
    const baselineDir = path.join(temp, 'baseline'); await mkdir(baselineDir);
    const baselineConfig = { ...config, storeDir: baselineDir, memoryFile: path.join(baselineDir, 'memory.jsonl') };
    const baselineStore = new BaselineStore(baselineConfig);
    for (const item of fixtureDecisions) await baselineStore.add({ kind: 'conclusion', text: curatedText(item), tags: [`project:${item.id}`] });
    const conditions = [];
    for (const condition of ['no-memory', 'curated-instructions', 'baseline-pathmark', 'decision-checks']) {
      const inputs = [];
      for (const entry of cases) {
        const fixture = fixtureDecisions.find((item) => item.id === entry.decisionId);
        let context = '';
        if (condition === 'curated-instructions' && !entry.unrelated) context = curatedText(fixture);
        if (condition === 'baseline-pathmark') context = (await baselineSearch(baselineStore, baselineConfig, entry.question, { tags: [`project:${entry.unrelated ? 'unrelated' : entry.decisionId}`] })).map((result) => result.record.text).join('\n');
        if (condition === 'decision-checks') context = JSON.stringify(actual.find((item) => item.id === entry.id).findings);
        inputs.push({ id: entry.id, question: entry.question, facts: entry.facts, context });
      }
      const question = 'Evaluate each independent proposed plan against ONLY its supplied context. Return JSON {"answers":[{"id":"...","status":"pass|conflict|unknown","reconsider":true|false}]}. Missing decisions or facts, incompatible fact types, or changed assumptions mean unknown. Reconsider is true only when the provided context establishes an assumption changed. Do not invent policies. Do not use tools or files. Inputs:\n' + JSON.stringify(inputs);
      const start = performance.now();
      console.log(`Evaluating ${condition}: ${inputs.length} synthetic judgments with the same Codex CLI settings.`);
      const answer = await synthesizeWithCommand({ config: { ...config, synthesisProvider: 'codex', chatTimeoutMs: 180000 }, question, context: [] });
      const parsed = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
      assert.equal(parsed.answers.length, cases.length);
      assert.equal(new Set(parsed.answers.map((item) => item.id)).size, cases.length);
      const scored = cases.map((entry) => { const response = parsed.answers.find((item) => item.id === entry.id); return { id: entry.id, expected: { status: entry.status, reconsider: entry.reconsider }, actual: response, correct: response?.status === entry.status && response?.reconsider === entry.reconsider }; });
      conditions.push({ condition, correct: scored.filter((item) => item.correct).length, total: cases.length, elapsedMs: performance.now() - start, inputChars: question.length, cases: scored });
    }
    report.modelEvaluation = { provider: 'codex-cli', model: config.codexModel ?? 'CLI default (exact model identifier not captured)', baselineVersion: JSON.parse(await readFile(path.join(baseline, 'package.json'), 'utf8')).version, conditions };
    report.limitations.push('One batched model run per condition; no statistical confidence or longitudinal product-effectiveness claim. Baseline and curated conditions receive the same decision content when retrieval succeeds.');
  }
  const output = arg('output');
  if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ ...report, modelEvaluation: report.modelEvaluation ? { ...report.modelEvaluation, conditions: report.modelEvaluation.conditions.map((item) => ({ condition: item.condition, correct: item.correct, total: item.total, elapsedMs: item.elapsedMs, inputChars: item.inputChars })) } : null }, null, 2));
} finally { if (baselineClose) await baselineClose(); await closeOpenStores(); await rm(temp, { recursive: true, force: true }); }
