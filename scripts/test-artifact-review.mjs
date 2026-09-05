import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PathmarkStore, closeOpenStores } from '../dist/store.js';
import { loadConfig } from '../dist/config.js';
import { recordRevision } from '../dist/approval.js';
import { projectScope } from '../dist/project.js';

const temp = await mkdtemp(path.join(os.tmpdir(), 'pathmark-artifact-review-'));
const root = path.join(temp, 'artifacts');
const html = '<!doctype html><title>Review fixture</title><p>Selected layout B</p>';
const hash = createHash('sha256').update(html).digest('hex');
const review = { artifact: { title: 'Review fixture', revision: 'R1', subpath: 'design.html', sha256: hash }, decision: 'approve', notes: 'Use layout B.', selection: { layout: 'B' } };
const tags = ['project:artifact-review'];
Object.assign(process.env, { PATHMARK_STORE_DIR: path.join(temp, 'store'), PATHMARK_ARTIFACT_ROOTS: JSON.stringify([root]), PATHMARK_CONCLUSION_APPROVAL: 'on', PATHMARK_SYNTHESIS_PROVIDER: 'client' });
const clients = [];
const results = [];
const test = async (name, action) => { await action(); results.push(name); };
const store = new PathmarkStore(loadConfig());
async function connect(name, overrides = {}) {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/index.js')], env: { ...process.env, ...overrides }, stderr: 'pipe' }));
  clients.push(client);
  return async (tool, input) => {
    const result = await client.callTool({ name: tool, arguments: input });
    const text = result.content.find((item) => item.type === 'text').text;
    if (result.isError) throw new Error(text);
    return JSON.parse(text);
  };
}
try {
  await mkdir(root);
  await writeFile(path.join(root, 'design.html'), html);
  const author = await connect('review-importer');
  const reader = await connect('decision-consumer');
  const input = { review: `Scratchpad review for "Review fixture":\n${JSON.stringify(review)}`, artifactRoot: root, source: 'codex://threads/fixture#message-1', tags };
  let imported;
  await test('import retains the full Scratchpad review as evidence without approving anything', async () => {
    imported = await author('import_scratchpad_review', input);
    assert.equal(imported.artifactCheck.status, 'match');
    assert.equal(imported.artifactCheck.authority, 'reported-review-only');
    assert.equal(imported.evidence.kind, 'memory');
    assert.equal(imported.evidence.approval, undefined);
    assert.deepEqual(JSON.parse(imported.evidence.text).review, review);
    assert.equal(JSON.parse(imported.evidence.text).source, input.source);
    assert.equal((await reader('task_brief', { tags })).decisions.length, 0);
    assert.equal((await author('import_scratchpad_review', input)).evidence.id, imported.evidence.id);
    for (const decision of ['feedback', 'changes']) {
      const result = await author('import_scratchpad_review', { ...input, review: JSON.stringify({ ...review, decision }) });
      assert.equal(result.artifactCheck.reportedDecision, decision);
      assert.notEqual(result.evidence.id, imported.evidence.id);
    }
  });
  await test('a reviewed decision travels across clients and changed HTML invalidates reuse', async () => {
    const proposal = (await author('create_conclusion', { text: 'Implement the reviewed layout B.', tags, evidenceIds: [imported.evidence.id], decision: {
      owner: 'Fixture reviewer', rationale: 'A fixture reviewer selected layout B.', checks: [{ field: 'layout', operator: 'eq', value: 'B', explanation: 'Use reviewed layout B.' }],
    } })).proposal;
    assert.equal(proposal.approval.status, 'pending');
    await author('approve_conclusion', { id: proposal.id, expectedRevision: recordRevision(proposal), decidedBy: 'synthetic-test-reviewer' });
    assert.equal((await reader('check_decisions', { tags, facts: { layout: 'B' } })).status, 'pass');
    assert.equal((await reader('check_decisions', { tags, facts: { layout: 'A' } })).status, 'conflict');
    await writeFile(path.join(root, 'design.html'), '<title>Unreviewed R2</title>');
    const changed = await reader('check_decisions', { tags, facts: { layout: 'B' } });
    assert.equal(changed.status, 'unknown');
    assert.equal(changed.findings[0].reconsider, true);
    assert.equal(changed.artifactReviews[0].status, 'changed');
    assert.equal((await reader('task_brief', { tags })).decisions[0].artifactReviews[0].status, 'changed');
    await rm(path.join(root, 'design.html'));
    assert.equal((await reader('check_artifact_review', { id: imported.evidence.id })).status, 'unavailable');
    await writeFile(path.join(root, 'design.html'), html);
    assert.equal((await reader('check_decisions', { tags, facts: { layout: 'B' } })).status, 'pass');
    const isolated = await connect('no-artifact-access', { PATHMARK_ARTIFACT_ROOTS: '[]' });
    assert.equal((await isolated('check_decisions', { tags, facts: { layout: 'B' } })).status, 'unknown');
    await assert.rejects(isolated('import_scratchpad_review', input), /not allowed/);
    assert.equal((await reader('task_brief', { tags: ['project:elsewhere'] })).decisions.length, 0);
  });
  await test('unsafe paths and symlinks cannot read outside explicitly allowed roots', async () => {
    for (const subpath of ['../outside.html', '/tmp/outside.html', 'folder/../../outside.html', 'C:\\outside.html', 'folder\\outside.html', 'design.txt']) {
      await assert.rejects(author('import_scratchpad_review', { ...input, review: JSON.stringify({ ...review, artifact: { ...review.artifact, subpath } }) }), /relative HTML/);
    }
    await writeFile(path.join(temp, 'outside.html'), 'private outside file');
    await symlink(path.join(temp, 'outside.html'), path.join(root, 'linked.html'));
    const linked = await author('import_scratchpad_review', { ...input, review: JSON.stringify({ ...review, artifact: { ...review.artifact, subpath: 'linked.html' } }) });
    assert.equal(linked.artifactCheck.status, 'unavailable');
    assert.equal(linked.artifactCheck.actualSha256, undefined);
    await assert.rejects(author('import_scratchpad_review', { ...input, artifactRoot: temp }), /not allowed/);
  });
  await test('malformed, oversized and secret-bearing payloads are handled without silent corruption', async () => {
    for (const payload of ['not json', JSON.stringify({ ...review, decision: 'approved' }), JSON.stringify({ ...review, artifact: { ...review.artifact, sha256: 'short' } }), JSON.stringify({ ...review, forgedAuthority: 'human-approved' })]) {
      await assert.rejects(author('import_scratchpad_review', { ...input, review: payload }));
    }
    await assert.rejects(author('import_scratchpad_review', { ...input, tags: [] }), /scope/);
    await assert.rejects(author('import_scratchpad_review', { ...input, review: 'x'.repeat(32_001) }));
    const secret = 'sk-proj-' + 'a'.repeat(28);
    const safe = await author('import_scratchpad_review', { ...input, review: JSON.stringify({ ...review, notes: secret, selection: { token: secret, nested: ['safe', secret] } }) });
    assert.equal(safe.evidence.text.includes(secret), false);
    assert.equal(JSON.parse(safe.evidence.text).review.selection.nested[0], 'safe');
    for (const data of [Buffer.alloc(2 * 1024 * 1024 + 1), Buffer.from([0xff]), Buffer.from('<p>\0</p>')]) {
      await writeFile(path.join(root, 'design.html'), data);
      assert.equal((await reader('check_artifact_review', { id: imported.evidence.id })).status, 'unavailable');
    }
    await writeFile(path.join(root, 'design.html'), html);
    await assert.rejects(reader('check_artifact_review', { id: 'absent' }), /not found/);
  });
  await test('CLI imports, resolves explicit project cwd, and checks the same evidence', async () => {
    const cli = (args, stdin) => JSON.parse(execFileSync(process.execPath, ['dist/index.js', ...args], { input: stdin, encoding: 'utf8', env: { ...process.env, PATHMARK_ARTIFACT_ROOTS: '[]' } }));
    const item = cli(['review', 'scratchpad', `--artifact-root=${root}`, '--source=fixture:cli', `--cwd=${root}`], JSON.stringify(review));
    assert.equal(item.artifactCheck.status, 'match');
    assert.ok(item.evidence.tags.includes(`project-id:${projectScope(root).id}`));
    assert.equal(cli(['review', 'artifact', `--artifact-root=${root}`, `--id=${item.evidence.id}`]).status, 'match');
    assert.equal(cli(['review', 'artifact', `--id=${item.evidence.id}`]).status, 'unavailable');
    assert.equal(cli(['decision', 'check', '--tag=project:artifact-review', `--artifact-root=${root}`], JSON.stringify({ facts: { layout: 'B' } })).status, 'pass');
  });
  await test('editing imported evidence invalidates its bound conclusion approval', async () => {
    await author('update_memory', { id: imported.evidence.id, text: 'Edited source without a review envelope.' });
    assert.equal((await reader('check_artifact_review', { id: imported.evidence.id })).status, 'unavailable');
    const result = await reader('check_decisions', { tags, facts: { layout: 'B' } });
    assert.equal(result.status, 'unknown');
    assert.match(result.findings[0].reasons[0], /evidence/);
  });
  assert.ok((await store.all()).length > 0);
  console.log(JSON.stringify({ status: 'passed', scenarios: results }, null, 2));
} finally {
  await Promise.all(clients.map((client) => client.close()));
  await closeOpenStores();
  await rm(temp, { recursive: true, force: true });
}
