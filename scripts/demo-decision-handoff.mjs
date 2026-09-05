import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixtureDecisions, decisionSpec } from './decision-fixtures.mjs';
import { recordRevision } from '../dist/approval.js';
const temp = await mkdtemp(path.join(os.tmpdir(), 'pathmark-handoff-demo-'));
const clients = [];
async function connect(name) {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/index.js')], env: { ...process.env, PATHMARK_STORE_DIR: temp, PATHMARK_SYNTHESIS_PROVIDER: 'client', PATHMARK_CONCLUSION_APPROVAL: 'on' }, stderr: 'pipe' }));
  clients.push(client);
  return async (name, args) => { const result = await client.callTool({ name, arguments: args }); if (result.isError) throw new Error(JSON.stringify(result.content)); return JSON.parse(result.content[0].text); };
}
try {
  const author = await connect('authoring-agent'); const reviewer = await connect('reviewing-agent');
  const item = fixtureDecisions[0]; const tags = ['project:handoff-demo'];
  const evidence = await author('remember', { text: item.rationale, tags: [...tags, 'role-user'] });
  const proposal = await author('create_conclusion', { text: item.text, decision: decisionSpec(item), evidenceIds: [evidence.id], tags });
  console.log('1. Authoring client proposed a decision with rationale and source evidence.');
  const queue = await reviewer('review_queue', { tags });
  console.log(`2. Review queue: ${queue.proposals[0].text}\n   Why: ${queue.proposals[0].decision.rationale}`);
  await author('approve_conclusion', { id: proposal.proposal.id, expectedRevision: recordRevision(proposal.proposal), decidedBy: 'synthetic-demo-reviewer' });
  const brief = await reviewer('task_brief', { tags });
  console.log(`3. A separate MCP client recovered approved revision ${brief.decisions[0].revision.slice(0, 12)}.`);
  for (const [label, facts] of [
    ['Hosted storage', { consent: 'local-only', storage: 'cloud' }],
    ['Local storage', { consent: 'local-only', storage: 'local' }],
    ['Changed consent', { consent: 'cloud-allowed', storage: 'cloud' }],
    ['Missing facts', {}],
  ]) {
    const result = await reviewer('check_decisions', { tags, facts });
    console.log(`   ${label}: ${result.status}${result.findings[0].reconsider ? ' — reconsider the old decision' : ''}`);
    if (result.status === 'conflict') await reviewer('decision_outcome', { checkId: result.checkId, outcome: 'useful' });
  }
  console.log('4. Feedback is tied to the checked revision. All demo data was synthetic.\nThis demonstrates a real MCP handoff, not autonomous reasoning by two models.');
} finally { await Promise.all(clients.map((client) => client.close())); await rm(temp, { recursive: true, force: true }); }
