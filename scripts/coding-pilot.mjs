import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { codingTasks } from './coding-pilot-fixtures.mjs';
import { PathmarkStore, closeOpenStores } from '../dist/store.js';
import { loadConfig } from '../dist/config.js';
import { taskBrief, checkDecisions } from '../dist/decisions.js';

const arg = (key) => process.argv.find((x) => x.startsWith(`--${key}=`))?.slice(key.length + 3);
const output = path.resolve(arg('output') ?? 'docs/validation/coding-pilot');
const hash = (x) => createHash('sha256').update(x).digest('hex');
function runCode(code, input) {
  if (code.length > 20000 || /\b(?:import|require|process|fetch|eval|Function|WebAssembly)\b/.test(code)) throw new Error('Only a pure solve function is permitted');
  const source = `${code}\nconst fixtureInput = ${JSON.stringify(input)}; const before = JSON.stringify(fixtureInput); const result = solve(fixtureInput); JSON.stringify({result,mutated:before!==JSON.stringify(fixtureInput)});`;
  const raw = vm.runInNewContext(source, Object.create(null), { timeout: 100, contextCodeGeneration: { strings: false, wasm: false } });
  const parsed = JSON.parse(raw);
  if (parsed.mutated) throw new Error('Input was mutated');
  return parsed.result;
}
function score(task, code) {
  const tests = task.tests.map(([input, expected], index) => {
    try { const actual = runCode(code, input); let passed = true; try { assert.deepEqual(actual, expected); } catch { passed = false; } return { index, passed, actual, expected }; }
    catch (error) { return { index, passed: false, error: error.message }; }
  });
  return { taskId: task.id, accepted: tests.every((x) => x.passed), tests };
}
if (!process.argv.includes('--run')) {
  assert.deepEqual(runCode('function solve(x) { return {n:x.n+1}; }', { n: 1 }), { n: 2 });
  assert.throws(() => runCode('function solve(x) { x.n=4; return x; }', { n: 1 }), /mutated/);
  assert.throws(() => runCode('function solve() { while(true) {} }', {}), /timed out/);
  assert.throws(() => runCode('function solve() { return process.env; }', {}), /pure/);
  for (const task of codingTasks) assert.ok(task.tests.length >= 2);
  console.log('Coding pilot harness self-check passed. Use --run for six model inference calls on synthetic fixtures.');
  process.exit(0);
}
await mkdir(output, { recursive: true });
const temp = await mkdtemp(path.join(os.tmpdir(), 'pathmark-coding-pilot-'));
const config = { ...loadConfig(), storeDir: temp, memoryFile: path.join(temp, 'memory.jsonl'), synthesisProvider: 'client' };
const store = new PathmarkStore(config);
let fixedModel = arg('model');
const runnerVersion = execFileSync(config.codexCommand, ['--version'], { encoding: 'utf8' }).trim();
const schema = { type: 'object', properties: { solutions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' } }, required: ['id', 'code'], additionalProperties: false } } }, required: ['solutions'], additionalProperties: false };
const schemaFile = path.join(temp, 'schema.json'); await writeFile(schemaFile, JSON.stringify(schema));
async function infer(prompt, key) {
  const finalFile = path.join(temp, `${key}.json`);
  const args = ['--ask-for-approval', 'never', '--disable', 'hooks', '--disable', 'memories', 'exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--cd', temp, '--output-schema', schemaFile, '--output-last-message', finalFile];
  if (fixedModel) args.push('--model', fixedModel);
  args.push('-');
  const env = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'LC_ALL'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const start = performance.now();
  const diagnostic = await new Promise((resolve, reject) => {
    const child = spawn(config.codexCommand, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; child.stdout.resume(); child.stderr.on('data', (x) => { stderr += x; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Inference timed out')); }, 240000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); if (code) reject(new Error(`Codex failed (${code}): ${stderr.slice(-1500)}`)); else resolve(stderr); });
    child.stdin.end(prompt);
  });
  const observedModel = diagnostic.match(/^model:\s*(.+)$/m)?.[1]?.trim();
  if (!fixedModel && !observedModel) throw new Error('Exact model was not reported; cannot establish a reproducible comparison');
  fixedModel ??= observedModel;
  if (observedModel && observedModel !== fixedModel) throw new Error(`Model drift: ${observedModel} != ${fixedModel}`);
  const answer = JSON.parse(await readFile(finalFile, 'utf8'));
  assert.equal(answer.solutions.length, codingTasks.length); assert.equal(new Set(answer.solutions.map((x) => x.id)).size, codingTasks.length);
  for (const task of codingTasks) assert.ok(answer.solutions.find((x) => x.id === task.id));
  const metadata = { model: fixedModel, elapsedMs: performance.now() - start, inputChars: prompt.length,
    reportedTokens: diagnostic.match(/tokens used\s*\n([\d,]+)/)?.[1]?.replaceAll(',', '') ?? null };
  await writeFile(path.join(output, `${key}.json`), JSON.stringify({ metadata, prompt, answer }, null, 2) + '\n');
  return { ...answer, metadata };
}
const instruction = 'This is a synthetic coding evaluation. Produce complete pure JavaScript function declarations named solve, one per independent task. No tools, files, shell, network, imports or dependencies. Return only the schema JSON. Each function has its own isolated runtime. Implement current task requirements; historical decisions never override explicit current requirements. Do not mutate input. Do not include test code. Object property order does not matter.\n';
try {
  const protocol = { frozenAt: new Date().toISOString(), runnerVersion, fixtureSha256: hash(await readFile(new URL('./coding-pilot-fixtures.mjs', import.meta.url))), runnerSha256: hash(await readFile(new URL(import.meta.url))),
    tasks: codingTasks.map((x) => x.id), conditionOrder: ['curated-instructions', 'pathmark', 'curated-plus-checks'],
    design: 'Eight synthetic implementation tasks per condition. One initial batched model call and one review batched call per condition; fresh sessions. Fixed tests withheld from both calls. Same exact model, same instruction content and two-call budget. Code is executed locally, no external side effects.',
    primaryMetric: 'All acceptance tests pass after review', secondaryMetrics: ['Initial acceptance failures', 'Failures repaired in review', 'New failures introduced in review', 'Elapsed inference time', 'Prompt characters'],
    nonMetrics: ['No human repeated corrections, review minutes, retention or willingness to pay are inferred.'],
    control: 'curated-plus-checks receives the same predicate results without Pathmark provenance, isolating benefit of executable checks from memory packaging.',
    stopRule: 'Run every condition once; retain failures; do not tune fixtures or prompts after seeing outcomes.' };
  await writeFile(path.join(output, 'protocol.json'), JSON.stringify(protocol, null, 2) + '\n');
  for (const task of codingTasks) {
    const { text, ...spec } = task.decision;
    const evidence = await store.add({ kind: 'memory', text: JSON.stringify(task.decision), tags: [`project:${task.id}`, 'role-user'] });
    const proposed = await store.proposeConclusion({ text, decision: spec, evidenceIds: [evidence.id], tags: [`project:${task.id}`] });
    await store.decideConclusion(proposed.record.id, 'approved', { decidedBy: 'synthetic-fixture-owner' });
  }
  const results = [];
  for (const [conditionIndex, condition] of protocol.conditionOrder.entries()) {
    const tasks = [];
    for (const task of codingTasks) {
      const context = condition === 'pathmark' ? await taskBrief(store, config, [`project:${task.id}`]) : task.decision;
      tasks.push({ id: task.id, task: task.task, context });
    }
    // Rotate task order by condition, preserving identical task content.
    tasks.push(...tasks.splice(0, conditionIndex * 2));
    console.log(`${condition}: initial implementation of ${tasks.length} modules.`);
    const initial = await infer(instruction + JSON.stringify({ tasks }), `${condition}-initial`);
    const reviews = [];
    for (const entry of tasks) {
      const task = codingTasks.find((x) => x.id === entry.id); const code = initial.solutions.find((x) => x.id === entry.id).code;
      let check;
      if (condition !== 'curated-instructions') {
        let facts; try { facts = Object.fromEntries(Object.entries(task.facts(runCode(code, task.factInput))).filter(([, value]) => value !== undefined)); } catch { facts = {}; }
        const actual = await checkDecisions(store, config, { tags: [`project:${task.id}`], facts });
        check = condition === 'pathmark' ? actual : { status: actual.status, findings: actual.findings.map(({ text, status, reconsider, reasons }) => ({ text, status, reconsider, reasons })) };
      }
      reviews.push({ ...entry, code, ...(check ? { check } : {}) });
    }
    console.log(`${condition}: review with fixed context${condition === 'curated-instructions' ? '' : ' and decision predicate results'}.`);
    const revised = await infer(instruction + 'Review each previous implementation. Correct any defects you identify. A historical check may be stale when current requirements override it; preserve the current requirement. Return every complete revised solution, including unchanged ones.\n' + JSON.stringify({ tasks: reviews }), `${condition}-review`);
    const initialScores = codingTasks.map((task) => score(task, initial.solutions.find((x) => x.id === task.id).code));
    const finalScores = codingTasks.map((task) => score(task, revised.solutions.find((x) => x.id === task.id).code));
    results.push({ condition, initialAccepted: initialScores.filter((x) => x.accepted).length, finalAccepted: finalScores.filter((x) => x.accepted).length, total: codingTasks.length,
      repaired: finalScores.filter((x, i) => x.accepted && !initialScores[i].accepted).length,
      introducedFailures: finalScores.filter((x, i) => !x.accepted && initialScores[i].accepted).length,
      metadata: [initial.metadata, revised.metadata], initialScores, finalScores });
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ status: results.length === 3 ? 'completed' : 'partial', generatedAt: new Date().toISOString(), model: fixedModel, runnerVersion, protocol, results }, null, 2) + '\n');
    console.log(`${condition}: ${results.at(-1).finalAccepted}/${codingTasks.length} accepted.`);
  }
} finally { await closeOpenStores(); await rm(temp, { recursive: true, force: true }); }
