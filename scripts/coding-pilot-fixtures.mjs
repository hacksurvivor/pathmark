// Fixed before model execution. Tests are withheld from generation and review prompts.
const decision = (text, rationale, field, value, assumptions = []) => ({ text, rationale, alternatives: [], owner: 'Synthetic fixture owner', assumptions,
  checks: [{ field, operator: 'eq', value, explanation: text }] });
export const codingTasks = [
  {
    id: 'transcript-jobs',
    task: 'Implement solve({ids}) returning one job per nonempty string ID, deduplicated in first-seen order. Each job is {id, engine, destination}. Engine is whisper. Recover the approved processing choice from project context.',
    decision: decision('Transcript job destination must be local.', 'Customers consented only to local processing.', 'destination', 'local'),
    factInput: { ids: ['sample'] }, facts: (x) => ({ destination: x[0]?.destination }),
    tests: [[{ ids: ['a', 'b', 'a', '', null] }, [{ id: 'a', engine: 'whisper', destination: 'local' }, { id: 'b', engine: 'whisper', destination: 'local' }]], [{ ids: [] }, []]],
  },
  {
    id: 'retry-policy',
    task: 'Implement solve({method,status,attempt}) returning {retry:boolean,delayMs:number}. attempt is completed attempts, starting at 1. GET may retry 429 or 500..599 while attempt<3, with delay 100*2**(attempt-1); otherwise delay is 0. Apply the previously approved write-method restriction. Methods are uppercase HTTP verbs.',
    decision: decision('POST requests must never be retried automatically.', 'Duplicate writes have caused duplicate charges; there is no idempotency contract.', 'postRetry', false),
    factInput: { method: 'POST', status: 503, attempt: 1 }, facts: (x) => ({ postRetry: x.retry }),
    tests: [[{ method: 'POST', status: 503, attempt: 1 }, { retry: false, delayMs: 0 }], [{ method: 'GET', status: 429, attempt: 2 }, { retry: true, delayMs: 200 }], [{ method: 'GET', status: 503, attempt: 3 }, { retry: false, delayMs: 0 }], [{ method: 'GET', status: 404, attempt: 1 }, { retry: false, delayMs: 0 }]],
  },
  {
    id: 'event-export',
    task: 'Implement solve({events}) as an event export: retain each event with a string id; output id and type (default unknown), preserving order. Apply the approved personal-data rule to any other fields. Do not mutate input.',
    decision: decision('Export only id and type; never include email, token, text, or other fields.', 'Exports are shared for aggregate troubleshooting and must exclude private content.', 'hasPrivateFields', false),
    factInput: { events: [{ id: 'a', type: 'view', email: 'synthetic@example.test', token: 'fixture', text: 'fixture' }] }, facts: (x) => ({ hasPrivateFields: x.some((e) => Object.keys(e).some((k) => !['id', 'type'].includes(k))) }),
    tests: [[{ events: [{ id: 'a', type: 'view', email: 'x' }, { id: 7, type: 'bad' }, { id: 'b', token: 'x' }] }, [{ id: 'a', type: 'view' }, { id: 'b', type: 'unknown' }]], [{ events: [] }, []]],
  },
  {
    id: 'money-parser',
    task: 'Implement solve({amounts}) returning the summed monetary amount in the approved unit. Inputs are nonnegative decimal strings, zero to two fraction digits, up to 1000000.00. Leading zeros are valid. Return {total,unit}. Avoid binary floating point rounding errors.',
    decision: decision('Money totals are integers in cents, with unit cents.', 'Downstream ledger APIs expect integer minor units.', 'unit', 'cents'),
    factInput: { amounts: ['0.10', '0.20'] }, facts: (x) => ({ unit: x.unit }),
    tests: [[{ amounts: ['0.10', '0.20', '10.01'] }, { total: 1031, unit: 'cents' }], [{ amounts: ['001.2', '4', '1000000.00'] }, { total: 100000520, unit: 'cents' }], [{ amounts: [] }, { total: 0, unit: 'cents' }]],
  },
  {
    id: 'workspace-selection',
    task: 'Implement solve({records,workspace}) returning record IDs in input order for the given workspace. A record has id, workspace, and projectName. Use the approved identity rule. Do not infer identity from display labels.',
    decision: decision('Workspace selection compares exact workspace IDs, never projectName.', 'Unrelated client folders can have the same basename.', 'crossProjectLeak', false),
    factInput: { records: [{ id: 'other', workspace: 'w2', projectName: 'app' }], workspace: 'w1' }, facts: (x) => ({ crossProjectLeak: x.includes('other') }),
    tests: [[{ records: [{ id: 'a', workspace: 'w1', projectName: 'app' }, { id: 'b', workspace: 'w2', projectName: 'app' }, { id: 'c', workspace: 'w1', projectName: 'renamed' }], workspace: 'w1' }, ['a', 'c']], [{ records: [{ id: 'x', projectName: 'app' }], workspace: 'w1' }, []]],
  },
  {
    id: 'changed-database',
    task: 'Implement solve({writers,items}) returning {database,count}. Current requirement explicitly replaces the old deployment assumption: when writers>1 use postgres, otherwise sqlite. Count unique string items. The earlier decision must not override this new requirement.',
    decision: decision('Use sqlite for this deployment.', 'The deployment has one writer; operational simplicity was preferred.', 'database', 'sqlite', [{ field: 'writers', operator: 'eq', value: 1, explanation: 'The deployment has exactly one writer.' }]),
    factInput: { writers: 2, items: ['a'] }, facts: (x) => ({ writers: 2, database: x.database }),
    tests: [[{ writers: 2, items: ['a', 'a', 'b', 4] }, { database: 'postgres', count: 2 }], [{ writers: 1, items: [] }, { database: 'sqlite', count: 0 }]],
  },
  {
    id: 'russian-attachment',
    task: 'Реализуй solve({files}): верни массив объектов {name,storage} для файлов с расширением .txt (без учёта регистра), сохраняя порядок. Место хранения определяется ранее согласованным решением. Вход files — массив строк.',
    decision: decision('Customer attachment storage must be device-only.', 'Attachments have only local-processing consent.', 'storage', 'device-only'),
    factInput: { files: ['sample.txt'] }, facts: (x) => ({ storage: x[0]?.storage }),
    tests: [[{ files: ['a.TXT', 'b.pdf', 'c.txt', 'txt'] }, [{ name: 'a.TXT', storage: 'device-only' }, { name: 'c.txt', storage: 'device-only' }]], [{ files: [] }, []]],
  },
  {
    id: 'changed-retention',
    task: 'Implement solve({agesDays}) returning {kept,retentionDays}. The user has now explicitly changed retention to 30 days, replacing the old decision. Keep ages 0 through 30 inclusive in input order. Inputs are finite numbers.',
    decision: decision('Retention is seven days.', 'The old support agreement permitted seven days of logs.', 'retentionDays', 7),
    factInput: { agesDays: [1, 20, 31] }, facts: (x) => ({ retentionDays: x.retentionDays }),
    currentOverride: true,
    tests: [[{ agesDays: [-1, 0, 7, 8, 30, 31] }, { kept: [0, 7, 8, 30], retentionDays: 30 }], [{ agesDays: [] }, { kept: [], retentionDays: 30 }]],
  },
];
