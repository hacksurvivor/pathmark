import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { recordRevision } from '../dist/approval.js';

// Pass the directory of an installed codex-scratchpad-plugin@0.4.0 package.
// This runs its real MCP server and viewer JS. DOM and host delivery are fixture doubles.
const packageDir = process.argv[2];
if (!packageDir) throw new Error('Usage: node scripts/demo-scratchpad-handoff.mjs /absolute/path/to/codex-scratchpad-plugin');
const temp = await mkdtemp(path.join(os.tmpdir(), 'scratchpad-pathmark-handoff-'));
const clients = [];
async function connect(name, file, env) {
  const client = new Client({ name, version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [file], cwd: temp, env: { ...process.env, ...env }, stderr: 'pipe' }));
  clients.push(client);
  return client;
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result;
}
const decoded = (result) => JSON.parse(result.content.find((item) => item.type === 'text').text);
try {
  const scratchpad = await connect('scratchpad-producer', path.resolve(packageDir, 'mcp/server.mjs'), {
    SCRATCHPAD_ROOT: path.join(temp, 'artifacts'), SCRATCHPAD_PROJECT_DIR: path.join(temp, 'project'), SCRATCHPAD_SESSION_ID: 'handoff-demo', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '',
  });
  assert.equal(scratchpad.getServerVersion().version, '0.4.0');
  const located = await call(scratchpad, 'scratchpad', { subpath: 'layout.html' });
  const artifactFile = located.content.find((item) => item.type === 'text').text;
  await writeFile(artifactFile, '<!doctype html><title>Handoff fixture</title><p>Layout B</p>');
  const opened = await call(scratchpad, 'open_html', { subpath: 'layout.html', revision: 'R1' });
  const widget = await scratchpad.readResource({ uri: opened._meta.ui.resourceUri });
  const emitted = await emittedReview(widget.contents[0].text, opened._meta.artifact);
  const review = JSON.parse(emitted.split('\n').slice(1).join('\n'));
  assert.equal(review.decision, 'approve');
  assert.equal(review.artifact.sha256, opened.structuredContent.artifact.sha256);
  assert.deepEqual(review.selection, { layout: 'B' });
  const env = { PATHMARK_STORE_DIR: path.join(temp, 'memory'), PATHMARK_ARTIFACT_ROOTS: JSON.stringify([path.dirname(artifactFile)]), PATHMARK_CONCLUSION_APPROVAL: 'on', PATHMARK_SYNTHESIS_PROVIDER: 'client' };
  const author = await connect('pathmark-importer', path.resolve('dist/index.js'), env);
  const consumer = await connect('pathmark-consumer', path.resolve('dist/index.js'), env);
  const pm = async (client, name, args) => decoded(await call(client, name, args));
  const tags = ['project:scratchpad-handoff-demo'];
  const imported = await pm(author, 'import_scratchpad_review', { review: emitted, artifactRoot: path.dirname(artifactFile), source: 'fixture:simulated-host-message', tags });
  assert.equal(imported.artifactCheck.status, 'match');
  assert.equal(imported.evidence.approval, undefined);
  const proposal = (await pm(author, 'create_conclusion', { text: 'Use the reviewed layout B.', tags, evidenceIds: [imported.evidence.id], decision: {
    owner: 'Synthetic fixture reviewer', rationale: 'Layout B is selected in the fixture review.', checks: [{ field: 'layout', operator: 'eq', value: 'B', explanation: 'Match the reviewed layout.' }],
  } })).proposal;
  assert.equal(proposal.approval.status, 'pending');
  await pm(author, 'approve_conclusion', { id: proposal.id, expectedRevision: recordRevision(proposal), decidedBy: 'synthetic-test-reviewer' });
  const before = await pm(consumer, 'check_decisions', { tags, facts: { layout: 'B' } });
  await writeFile(artifactFile, '<!doctype html><title>R2 unreviewed</title><p>Layout C</p>');
  const after = await pm(consumer, 'check_decisions', { tags, facts: { layout: 'B' } });
  assert.equal(before.status, 'pass'); assert.equal(after.status, 'unknown'); assert.equal(after.artifactReviews[0].status, 'changed');
  console.log(JSON.stringify({ status: 'passed', scratchpadVersion: scratchpad.getServerVersion().version,
    publishedViewerSha256: (await import('node:crypto')).createHash('sha256').update(await readFile(path.resolve(packageDir, 'assets/artifact-viewer.html'))).digest('hex'),
    emittedReview: review, importedAs: imported.evidence.kind, automaticConclusionApproval: false,
    beforeArtifactEdit: before.status, afterArtifactEdit: after.status,
    limits: 'Real package MCP server and viewer script; simulated DOM and host acknowledgement; synthetic reviewer. No live Codex user approval or productivity effect measured.' }, null, 2));
} finally {
  await Promise.all(clients.map((client) => client.close()));
  await rm(temp, { recursive: true, force: true });
}

async function emittedReview(html, artifact) {
  const elements = new Map(), listeners = [], messages = [];
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  class Element {
    constructor(dataset = {}) { this.dataset = dataset; this.tagName = 'BUTTON'; this.value = ''; this.events = {}; this.contentWindow = {}; this.classList = { toggle() {} }; }
    setAttribute() {}
    removeAttribute() {}
    addEventListener(name, action) { (this.events[name] ??= []).push(action); }
    async trigger(name) { for (const action of this.events[name] ?? []) action({ target: this }); await flush(); }
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], new Element());
  const devices = ['desktop', 'tablet', 'mobile'].map((device) => new Element({ device }));
  const decisions = ['feedback', 'changes', 'approve'].map((decision) => new Element({ decision }));
  const parent = { postMessage: (message) => messages.push(message) };
  const window = { parent, addEventListener: (name, action) => { if (name === 'message') listeners.push(action); } };
  class Parser {
    parseFromString(source) { return { querySelectorAll: () => [], createElement: () => ({ setAttribute() {} }), head: { prepend() {} }, documentElement: { outerHTML: source } }; }
  }
  const script = html.slice(html.indexOf('<script>\n    (() => {') + 8, html.lastIndexOf('</script>'));
  vm.runInNewContext(script, { window, document: { getElementById: (id) => elements.get(id), querySelectorAll: (selector) => selector === '[data-decision]' ? decisions : devices, body: new Element() }, DOMParser: Parser, TextEncoder, Map, JSON, Date, Math, Error, setTimeout: () => 1, clearTimeout() {} });
  const host = (data, source = parent) => listeners.forEach((action) => action({ source, data }));
  host({ jsonrpc: '2.0', id: messages.find((item) => item.method === 'ui/initialize').id, result: { hostContext: { availableDisplayModes: ['inline', 'fullscreen'] } } });
  await flush();
  host({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { artifact } } });
  await elements.get('artifact').trigger('load');
  host({ type: 'scratchpad:update', state: { layout: 'B' } }, elements.get('artifact').contentWindow);
  elements.get('notes').value = 'Use layout B.';
  await elements.get('notes').trigger('input');
  await decisions[2].trigger('click');
  await elements.get('send').trigger('click');
  const sent = messages.find((item) => item.method === 'ui/message');
  assert.ok(sent, 'Published viewer must emit the review message');
  host({ jsonrpc: '2.0', id: sent.id, result: {} });
  await flush();
  assert.equal(elements.get('send').textContent, 'Sent');
  return sent.params.content[0].text;
}
