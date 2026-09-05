import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PathmarkStore, closeOpenStores } from '../dist/store.js';
import { loadConfig } from '../dist/config.js';
import { recordRevision } from '../dist/approval.js';
import { prompt, recall } from '../dist/codex/capture.js';
import { workspaceTag, projectScope, initializeProject } from '../dist/project.js';

const temp = await mkdtemp(path.join(os.tmpdir(), 'pathmark-decision-assurance-'));
Object.assign(process.env, { PATHMARK_STORE_DIR: temp, PATHMARK_SYNTHESIS_PROVIDER: 'client', PATHMARK_CODEX_VISIBLE_RECALL: 'off', PATHMARK_CONCLUSION_APPROVAL: 'on' });
const store = new PathmarkStore(loadConfig());
const clients = [];
async function connect(name) {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/index.js')], env: { ...process.env }, stderr: 'pipe' }));
  clients.push(client);
  return async (tool, args = {}) => {
    const result = await client.callTool({ name: tool, arguments: args });
    if (result.isError) throw new Error(result.content.find((item) => item.type === 'text').text);
    return JSON.parse(result.content.find((item) => item.type === 'text').text);
  };
}
const results = [];
async function test(name, action) { await action(); results.push(name); }
try {
  const agentA = await connect('handoff-author');
  const agentB = await connect('handoff-reviewer');
  const approve = async (text, tags, extra = {}) => {
    const item = await agentA('create_conclusion', { text, tags, ...extra });
    return (await agentA('approve_conclusion', { id: item.proposal.id, expectedRevision: recordRevision(item.proposal), decidedBy: 'fixture-reviewer' })).approved;
  };
  await test('approvals bind revisions and preserve the last approved value', async () => {
    const original = await approve('The release budget is ten dollars.', ['project:approval']);
    assert.equal(original.approval.revision, recordRevision(original));
    const pending = (await agentA('update_memory', { id: original.id, text: 'The release budget is ten thousand dollars.' })).updated;
    assert.notEqual(pending.id, original.id); assert.equal(pending.approval.status, 'pending');
    assert.equal((await agentB('chat', { question: 'release budget', tags: ['project:approval'] })).answer, original.text);
    const changed = (await agentA('update_memory', { id: pending.id, text: 'The release budget is twenty dollars.' })).updated;
    await assert.rejects(agentA('approve_conclusion', { id: pending.id, expectedRevision: recordRevision(pending) }), /changed since review/);
    await agentA('approve_conclusion', { id: changed.id, expectedRevision: recordRevision(changed) });
    assert.equal((await agentB('chat', { question: 'release budget', tags: ['project:approval'] })).answer, changed.text);
    assert.equal(await store.get(original.id), undefined);
  });
  await test('competing replacements cannot revive a superseded decision', async () => {
    const original = await approve('Citrine reports use metric units.', ['project:race']);
    const first = (await agentA('update_memory', { id: original.id, text: 'Citrine reports use SI units.' })).updated;
    const second = (await agentA('update_memory', { id: original.id, text: 'Citrine reports use imperial units.' })).updated;
    await agentA('approve_conclusion', { id: first.id });
    await assert.rejects(agentB('approve_conclusion', { id: second.id }), /no longer active/);
  });
  await test('same basename does not contaminate prompt or startup scope', async () => {
    const a = '/review/client-a/app'; const b = '/review/client-b/app';
    const record = await approve('Cobalt release budgets require finance review.', ['project:app', workspaceTag(a)]);
    assert.equal((await prompt({ cwd: b, session_id: 'scope-b', prompt: 'Explain Cobalt release budgets and finance review.' })).includes(record.id), false);
    assert.equal((await recall({ cwd: b })).includes(record.id), false);
    assert.equal((await recall({ cwd: a })).includes(record.id), true);
  });
  await test('shared Git worktrees have stable identity; explicit mapping survives directory moves', async () => {
    const root = path.join(temp, 'repo'); const other = path.join(temp, 'worktree');
    await mkdir(root); execFileSync('git', ['init', '--quiet', root]);
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['worktree', 'add', '--detach', other], { cwd: root, stdio: 'ignore' });
    assert.equal(projectScope(root).id, projectScope(other).id);
    const mapped = initializeProject(root, 'shared-project-identity');
    assert.equal(projectScope(other).id, mapped.id);
    await assert.rejects(async () => initializeProject(root, 'different-identity'), /different identity/);
    const copy = path.join(temp, 'copy'); await mkdir(copy); await writeFile(path.join(copy, 'pathmark.project.json'), await readFile(path.join(root, 'pathmark.project.json')));
    assert.equal(projectScope(copy).id, mapped.id);
    const subdir = path.join(copy, "nested"); await mkdir(subdir); assert.equal(projectScope(subdir).id, mapped.id);
  });
  await test('inherited evidence scope agrees across snapshot, chat, export and audit', async () => {
    const raw = await agentA('remember', { text: 'Marigold approvals require a product owner.', tags: ['workspace:inherited', 'role-user'] });
    const record = await approve(raw.text, [], { evidenceIds: [raw.id] });
    const scoped = await agentB('chat', { question: 'Marigold approvals product owner', tags: ['workspace:inherited'] });
    assert.equal(scoped.records.some((item) => item.id === record.id), true);
    const snapshot = await agentB('get_memory_snapshot', { tags: ['workspace:inherited'] });
    assert.equal(snapshot.context.includes('[PROJECT]'), true);
    assert.equal((await agentB('get_memory_snapshot', { tags: ['workspace:other'] })).records.some((item) => item.id === record.id), false);
    const audit = await agentB('audit_memory', { tags: ['workspace:inherited'] });
    assert.equal(audit.inventory.approvedConclusions, 1); assert.equal(audit.recall.outOfScopeReferences, 0);
    const file = path.join(temp, 'export.jsonl'); await store.exportTo(file, { tags: ['workspace:inherited'] });
    assert.equal((await readFile(file, 'utf8')).includes(record.id), true);
  });
  await test('English paraphrase and Russian query recall a storage constraint', async () => {
    const record = await approve('Customer records must remain on the laptop; remote storage is prohibited.', ['project:language']);
    for (const question of ['Can client information be uploaded to a cloud service?', 'Можно ли отправлять данные клиентов в облако?']) {
      const response = await agentB('chat', { question, tags: ['project:language'] });
      assert.equal(response.records.some((item) => item.id === record.id), true, question);
    }
    assert.equal((await agentB('chat', { question: 'How do clouds form in the atmosphere?', tags: ['project:language'] })).records.length, 0);
  });
  await test('mixed intents return approved preference and scoped evidence', async () => {
    await approve('The team prefers violet button colors.', ['project:mixed']);
    const raw = await agentA('remember', { text: 'Customer transcripts remain on this computer because consent excludes external storage.', tags: ['project:mixed', 'role-user'] });
    const answer = await agentB('chat', { question: 'What button colors are preferred and where must customer transcripts remain?', tags: ['project:mixed'] });
    assert.equal(answer.records.some((item) => item.id === raw.id), true);
    assert.equal(answer.retrievalMode, 'mixed_evidence');
    const partial = await agentB('chat', { question: 'What button colors are preferred and who won the marathon?', tags: ['project:mixed'] });
    assert.equal(partial.complete, false); assert.match(partial.answer, /Unanswered/);
  });
  await test('reviewing temporary evidence persists and edits reopen review', async () => {
    const raw = await agentA('remember', { text: 'The temporary launch rehearsal completed at noon. ' + 'Long bounded evidence. '.repeat(150), tags: ['project:review', 'role-user'] });
    const queue = await agentB('review_queue', { tags: ['project:review'] });
    const entry = queue.evidence.find((item) => item.id === raw.id);
    assert.equal(entry.revision, recordRevision(raw));
    await agentB('review_evidence', { id: raw.id, revision: entry.revision, status: 'temporary', reviewedBy: 'fixture-user' });
    assert.equal((await agentB('consolidate_memory', { tags: ['project:review'], apply: false })).backlogCount, 0);
    await agentA('update_memory', { id: raw.id, text: 'Customer records must remain local.' });
    assert.equal((await agentB('review_queue', { tags: ['project:review'] })).evidenceBacklog, 1);
    await assert.rejects(agentB('review_evidence', { id: raw.id, revision: entry.revision, status: 'temporary', reviewedBy: 'fixture-user' }), /changed since review/);
  });
  await test('two MCP clients hand off decisions, conflicts, changed assumptions and outcomes', async () => {
    const tags = ['project:handoff'];
    const evidence = await agentA('remember', { text: 'Consent covers local transcript storage only.', tags: [...tags, 'role-user'] });
    const rule = await approve('Keep customer transcripts local.', tags, { evidenceIds: [evidence.id], decision: {
      owner: 'Project owner', rationale: 'Consent covers local processing only.', alternatives: ['Hosted transcription was rejected.'],
      assumptions: [{ field: 'consent', operator: 'eq', value: 'local-only', explanation: 'Consent permits local processing only.' }],
      checks: [{ field: 'transcriptStorage', operator: 'eq', value: 'local', explanation: 'Hosted transcript storage conflicts with consent.' }],
    } });
    const brief = await agentB('task_brief', { tags });
    assert.equal(brief.decisions[0].id, rule.id);
    const conflict = await agentB('check_decisions', { tags, plan: 'Use hosted transcription.', facts: { consent: 'local-only', transcriptStorage: 'cloud' } });
    assert.equal(conflict.status, 'conflict'); assert.equal(conflict.findings[0].revision, rule.approval.revision);
    const pass = await agentB('check_decisions', { tags, facts: { consent: 'local-only', transcriptStorage: 'local' } });
    assert.equal(pass.status, 'pass');
    assert.equal((await agentB('check_decisions', { tags, facts: {} })).status, 'unknown');
    const reopened = await agentB('check_decisions', { tags, facts: { consent: 'cloud-allowed', transcriptStorage: 'cloud' } });
    assert.equal(reopened.status, 'unknown'); assert.equal(reopened.findings[0].reconsider, true);
    const outcome = await agentB('decision_outcome', { checkId: conflict.checkId, outcome: 'useful' });
    assert.equal(outcome.revisions[0].revision, rule.approval.revision);
    await agentA('update_memory', { id: evidence.id, text: 'Consent now includes cloud processing.' });
    const stale = await agentB('check_decisions', { tags, facts: { consent: 'local-only', transcriptStorage: 'local' } });
    assert.equal(stale.status, 'unknown'); assert.match(stale.findings[0].reasons[0], /evidence/);
  });
  await test('direct recall and startup snapshot have feedback identifiers', async () => {
    const exact = await agentB('recall_memory', { query: 'release budget', tags: ['project:approval'] });
    assert.ok(exact.recallId);
    await agentB('rate_recall', { recallId: exact.recallId, relevantIds: exact.usedMemories.map((item) => item.id) });
    const before = (await store.all()).filter((item) => item.tags.includes('channel-snapshot')).length;
    await recall({ cwd: '/review/client-a/app' });
    assert.ok((await store.all()).filter((item) => item.tags.includes('channel-snapshot')).length > before);
  });
  await test('score-aware reranking preserves meaning and abstains on low confidence', async () => {
    const record = await approve('Packaged connectors must remain offline.', ['project:semantic-score']);
    const scorer = path.join(temp, 'scorer.mjs');
    const scorerBody = (score) => 'let s=""; for await (const c of process.stdin) s+=c; console.log(JSON.stringify({results:JSON.parse(s).candidates.map(c=>({id:c.id,score:' + score + '}))}));';
    await writeFile(scorer, scorerBody(0.95));
    const prior = process.env.PATHMARK_RERANK_COMMAND;
    process.env.PATHMARK_RERANK_COMMAND = `"${process.execPath}" "${scorer}"`;
    const semantic = await connect('scored-semantic-client');
    if (prior === undefined) delete process.env.PATHMARK_RERANK_COMMAND; else process.env.PATHMARK_RERANK_COMMAND = prior;
    const high = await semantic('chat', { question: 'Is a network transfer permitted?', tags: ['project:semantic-score'] });
    assert.equal(high.records[0].id, record.id);
    await writeFile(scorer, scorerBody(0.2));
    assert.equal((await semantic('chat', { question: 'Is a network transfer permitted?', tags: ['project:semantic-score'] })).records.length, 0);
  });
  await test('the actual CLI can propose, review, approve and check a decision', async () => {
    const cli = (args, input) => JSON.parse(execFileSync(process.execPath, ['dist/index.js', ...args], { encoding: 'utf8', env: { ...process.env }, input }));
    const tags = ['project:cli-flow'];
    const evidence = await agentA('remember', { text: 'Citrine records require a reviewed label.', tags: [...tags, 'role-user'] });
    const proposed = cli(['decision', 'propose', '--tag=project:cli-flow'], JSON.stringify({ text: evidence.text, evidenceIds: [evidence.id], decision: { owner: 'Fixture', rationale: 'Review is required for this workflow.', assumptions: [], alternatives: [], checks: [
      { field: 'label', operator: 'includes', value: 'reviewed', explanation: 'Include a reviewed label.' },
      { field: 'label', operator: 'not-includes', value: 'blocked', explanation: 'Blocked labels cannot pass.' },
      { field: 'attempts', operator: 'lte', value: 1, explanation: 'One attempt maximum.' },
      { field: 'coverage', operator: 'gte', value: 80, explanation: 'At least eighty percent coverage.' },
      { field: 'region', operator: 'neq', value: 'restricted', explanation: 'Exclude the restricted region.' },
    ] } }));
    const queue = cli(['review', '--tag=project:cli-flow']);
    assert.equal(queue.proposals[0].id, proposed.record.id);
    cli(['review', 'approve', '--id=' + proposed.record.id, '--revision=' + queue.proposals[0].revision]);
    assert.equal(cli(['decision', 'brief', '--tag=project:cli-flow']).decisions.length, 1);
    const check = cli(['decision', 'check', '--tag=project:cli-flow'], JSON.stringify({ facts: { label: 'reviewed', attempts: 1, coverage: 90, region: 'allowed' } }));
    assert.equal(check.status, 'pass');
    assert.equal(cli(['decision', 'outcome', '--check-id=' + check.checkId, '--outcome=no-effect']).outcome, 'no-effect');
    const missing = cli(['decision', 'check', '--tag=project:cli-flow'], JSON.stringify({ facts: { label: 17, attempts: '1' } }));
    assert.equal(missing.status, 'unknown');
    const conflicts = cli(['decision', 'check', '--tag=project:cli-flow'], JSON.stringify({ facts: { label: 'blocked', attempts: 2, coverage: 10, region: 'restricted' } }));
    assert.equal(conflicts.status, 'conflict');
  });
  await test('project filtering precedes snapshot budgets', async () => {
    const record = await approve('Saffron design must remain accessible.', ['project:saffron']);
    await store.addRecords(Array.from({ length: 502 }, (_, index) => ({ id: 'unrelated-' + index, kind: 'conclusion', text: 'Unrelated decision ' + index, tags: ['project:unrelated'], updatedAt: '2099-01-01T00:00:00.000Z' })));
    const snapshot = await agentB('get_memory_snapshot', { tags: ['project:saffron'] });
    assert.equal(snapshot.records.some((item) => item.id === record.id), true);
  });
  console.log(JSON.stringify({ status: 'passed', scenarios: results }, null, 2));
} finally {
  await Promise.all(clients.map((client) => client.close()));
  await closeOpenStores();
  await rm(temp, { recursive: true, force: true });
}
