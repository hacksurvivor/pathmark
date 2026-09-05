export const fixtureDecisions = [
  { id: 'transcripts', text: 'Customer transcripts remain on the local computer.', rationale: 'Customers consented only to local processing.', field: 'storage', allowed: 'local', denied: 'cloud', assumption: 'consent', expectedAssumption: 'local-only', changedAssumption: 'cloud-allowed', question: 'Can client information be sent to a hosted service?', russian: 'Можно ли отправлять данные клиентов в облако?' },
  { id: 'database', text: 'Use SQLite while the application has a single writer.', rationale: 'A single process does not need a database service.', field: 'database', allowed: 'sqlite', denied: 'postgres', assumption: 'writers', expectedAssumption: 1, changedAssumption: 4, question: 'Which persistence engine fits this plan?', russian: 'Какое хранилище подходит для этого плана?' },
  { id: 'retries', text: 'Controlled calls make one attempt without automatic retries.', rationale: 'Repeated attempts can create duplicate bookings.', field: 'attempts', allowed: 1, denied: 3, assumption: 'callMode', expectedAssumption: 'controlled', changedAssumption: 'batch-approved', question: 'Should another attempt be made automatically?', russian: 'Нужно ли повторять звонок автоматически?' },
  { id: 'release', text: 'A release requires signed artifacts.', rationale: 'The current distribution channel verifies signatures.', field: 'signed', allowed: true, denied: false, assumption: 'channel', expectedAssumption: 'public', changedAssumption: 'local-fixture', question: 'Are these build outputs ready for distribution?', russian: 'Готовы ли эти файлы к распространению?' },
  { id: 'messages', text: 'Client messages need review before sending.', rationale: 'The current customer workflow includes a human review.', field: 'reviewed', allowed: true, denied: false, assumption: 'workflow', expectedAssumption: 'human-reviewed', changedAssumption: 'approved-template', question: 'Can the prepared customer reply proceed?', russian: 'Можно ли отправить подготовленный ответ клиенту?' },
];
export function decisionSpec(item) {
  return { owner: 'Fixture project owner', rationale: item.rationale, alternatives: [],
    assumptions: [{ field: item.assumption, operator: 'eq', value: item.expectedAssumption, explanation: `Applies while ${item.assumption} equals ${JSON.stringify(item.expectedAssumption)}.` }],
    checks: [{ field: item.field, operator: 'eq', value: item.allowed, explanation: item.text }],
  };
}
export function curatedText(item) {
  return `${item.text}\nReason: ${item.rationale}\nOnly applies while ${item.assumption} = ${JSON.stringify(item.expectedAssumption)}.\nRequired: ${item.field} = ${JSON.stringify(item.allowed)}.\nIf the assumption changes, reconsider the decision. Missing or type-incompatible facts mean unknown.`;
}
export function benchmarkCases() {
  return fixtureDecisions.flatMap((item) => {
    const good = { [item.assumption]: item.expectedAssumption, [item.field]: item.allowed };
    return [
      { variant: 'conflict', facts: { ...good, [item.field]: item.denied }, status: 'conflict', reconsider: false },
      { variant: 'pass', facts: good, status: 'pass', reconsider: false },
      { variant: 'missing-fact', facts: { [item.assumption]: item.expectedAssumption }, status: 'unknown', reconsider: false },
      { variant: 'changed-assumption', facts: { ...good, [item.assumption]: item.changedAssumption }, status: 'unknown', reconsider: true },
      { variant: 'missing-assumption', facts: { [item.field]: item.allowed }, status: 'unknown', reconsider: false },
      { variant: 'wrong-type', facts: { ...good, [item.field]: typeof item.allowed === 'string' ? 42 : String(item.allowed) }, status: 'unknown', reconsider: false },
      { variant: 'russian-conflict', facts: { ...good, [item.field]: item.denied }, status: 'conflict', reconsider: false },
      { variant: 'different-project', facts: good, status: 'unknown', reconsider: false, unrelated: true },
    ].map((variant) => ({ ...variant, id: `${item.id}-${variant.variant}`, decisionId: item.id, question: variant.variant === 'russian-conflict' ? item.russian : ['pass', 'missing-fact', 'wrong-type', 'changed-assumption'].includes(variant.variant) ? `${item.text} ${item.assumption} ${item.field}` : item.question }));
  });
}
