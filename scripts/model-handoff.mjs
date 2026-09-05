import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PathmarkStore, closeOpenStores } from '../dist/store.js';
import { loadConfig } from '../dist/config.js';
import { recordRevision } from '../dist/approval.js';
const temp = await mkdtemp(path.join(os.tmpdir(), 'pathmark-model-handoff-'));
const storeDir = path.join(temp, 'memory');
const config = { ...loadConfig(), storeDir, memoryFile: path.join(storeDir, 'memory.jsonl'), synthesisProvider: 'client' };
const store = new PathmarkStore(config);
const scope = 'project:model-handoff';
const outputPath = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
async function saveReport(report) {
  if (outputPath) {
    await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
}
async function runAgent(prompt) {
  const args = ['--ask-for-approval', 'never', '--disable', 'hooks', '--disable', 'memories',
    '-c', `mcp_servers.pathmark.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.pathmark.args=${JSON.stringify([path.resolve('dist/index.js')])}`,
    '-c', `mcp_servers.pathmark.env.PATHMARK_STORE_DIR=${JSON.stringify(storeDir)}`,
    '-c', 'mcp_servers.pathmark.env.PATHMARK_SYNTHESIS_PROVIDER="client"',
    '-c', 'mcp_servers.pathmark.env.PATHMARK_CONCLUSION_APPROVAL="on"',
    'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--cd', temp, '-'];
  const env = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'LC_ALL'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  const output = await new Promise((resolve, reject) => {
    const child = spawn(config.codexCommand, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Model handoff timed out')); }, 180000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); if (code) reject(new Error(stderr.slice(-4000))); else resolve({ stdout, stderr }); });
    child.stdin.end(prompt);
  });
  const events = output.stdout.trim().split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const messages = events.filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message');
  const final = messages.at(-1)?.item?.text ?? '';
  const answer = JSON.parse(final.slice(final.indexOf('{'), final.lastIndexOf('}') + 1));
  return { answer, events, diagnostics: output.stderr.slice(-3000), model: output.stderr.match(/^model:\s*(.+)$/m)?.[1] ?? null };
}
try {
  console.log('Authoring model: capture synthetic evidence and propose a pending decision through MCP.');
  const author = await runAgent(`This is an isolated synthetic Pathmark integration test. Only use Pathmark MCP tools. Do not inspect files or use shell/network tools. Capture this user evidence with remember, tags ["${scope}","role-user"]: "Customer consent covers local transcript processing only." Then use create_conclusion to propose "Customer transcripts remain local", tagged "${scope}", citing that evidence ID, with decision {owner:"Fixture owner",rationale:"Consent covers local processing only",alternatives:[],assumptions:[{field:"consent",operator:"eq",value:"local-only",explanation:"Consent covers local processing only"}],checks:[{field:"storage",operator:"eq",value:"local",explanation:"Cloud storage conflicts with local consent"}]}. Do not approve it. Return JSON {"proposalId":"...","evidenceId":"..."}.`);
  const pending = await store.get(author.answer.proposalId);
  if (!pending) throw new Error(author.answer.error || 'Author did not persist a proposal in the isolated store');
  assert.equal(pending.approval.status, 'pending'); assert.ok(pending.decision);
  const approved = await store.decideConclusion(pending.id, 'approved', { expectedRevision: recordRevision(pending), decidedBy: 'synthetic-fixture-runner' });
  console.log('Fixture runner approved the exact proposal revision. Starting a fresh reviewing model session.');
  const reviewer = await runAgent(`This is an isolated synthetic Pathmark integration test. Only use task_brief and check_decisions from Pathmark MCP. Do not inspect files or use shell/network tools. In scope tags ["${scope}"], review a proposed plan to use hosted transcript storage while consent remains local-only. First recover the approved decision via task_brief, then call check_decisions with facts {"consent":"local-only","storage":"cloud"}. Return JSON {"status":"...","checkId":"...","decisionId":"..."} using the tool result. Do not change any memories or approve anything.`);
  assert.equal(reviewer.answer.status, 'conflict'); assert.equal(reviewer.answer.decisionId, approved.id);
  const check = await store.get(reviewer.answer.checkId); assert.ok(check.tags.includes('decision-check'));
  const observed = JSON.parse(check.text); assert.equal(observed.findings[0].revision, approved.approval.revision);
  const report = { generatedAt: new Date().toISOString(), status: 'passed', kind: 'two-independent-model-sessions-over-mcp',
    scope, authorModel: author.model, reviewerModel: reviewer.model, proposalId: approved.id, approvedRevision: approved.approval.revision,
    result: reviewer.answer, authorToolCalls: author.events.filter((event) => event.item?.type === 'mcp_tool_call').map((event) => event.item.tool), reviewerToolCalls: reviewer.events.filter((event) => event.item?.type === 'mcp_tool_call').map((event) => event.item.tool),
    limitations: ['One synthetic handoff; not proof of real-task productivity.', 'Fixture runner, not an actual participant, approved the synthetic decision.'] };
  await saveReport(report);
} catch (error) {
  await saveReport({ generatedAt: new Date().toISOString(), status: /approval/i.test(error.message) ? 'blocked' : 'failed',
    kind: 'two-independent-model-sessions-over-mcp', reason: error.message,
    limitations: ['A blocked or failed run does not verify the model handoff. No approval policy is relaxed by this script.'] });
  process.exitCode = 1;
} finally { await closeOpenStores(); await rm(temp, { recursive: true, force: true }); }
