import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../dist/config.js";
import { prompt } from "../dist/codex/capture.js";
import { closeOpenStores, PathmarkStore } from "../dist/store.js";

const storeDir = await mkdtemp(path.join(os.tmpdir(), "pathmark-memory-quality-"));
process.env.PATHMARK_STORE_DIR = storeDir;
process.env.PATHMARK_CODEX_PROACTIVE_RECALL = "on";
process.env.PATHMARK_CODEX_VISIBLE_RECALL = "on";

const store = new PathmarkStore(loadConfig());
const at = "2026-08-16T00:00:00.000Z";
const workspace = (cwd) => `workspace:${createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 12)}`;
const scoped = (project, cwd) => ["codex-raw", "codex-session", "role-user", `project:${project}`, workspace(cwd)];

await store.addRecords([
  {
    id: "scoped-visible-evidence",
    kind: "memory",
    text: "Pathmark memory audits expose exact evidence IDs and provenance in visible recall.",
    tags: scoped("pathmark", "/workspace/pathmark"),
    source: "quality-fixture",
    createdAt: at,
  },
  {
    id: "scoped-russian-ranking",
    kind: "memory",
    text: "Русский ranking отбрасывает общие стоп-слова и не подмешивает нерелевантные проекты.",
    tags: scoped("pathmark", "/workspace/pathmark"),
    source: "quality-fixture",
    createdAt: at,
  },
  {
    id: "scoped-worktree-scope",
    kind: "memory",
    text: "Project scope connects related worktrees while exact workspace remains the strongest automatic boundary.",
    tags: scoped("pathmark", "/workspace/pathmark"),
    source: "quality-fixture",
    createdAt: at,
  },
  {
    id: "scoped-safe-preview",
    kind: "memory",
    text: "Injected previews are escaped and treated as untrusted historical data.",
    tags: scoped("pathmark", "/workspace/pathmark"),
    source: "quality-fixture",
    createdAt: at,
  },
  {
    id: "scoped-abstention",
    kind: "memory",
    text: "Automatic recall abstains when no relevant scoped memory survives ranking.",
    tags: scoped("pathmark", "/workspace/pathmark"),
    source: "quality-fixture",
    createdAt: at,
  },
  {
    id: "cross-meetily",
    kind: "memory",
    text: "Meetily transcription design uses a local-first desktop capture architecture.",
    tags: scoped("meetily", "/workspace/meetily"),
    source: "quality-fixture",
    createdAt: at,
  },
  {
    id: "cross-call-center",
    kind: "memory",
    text: "Call-center Mexico calls use a bounded daily schedule and stop before 17:30.",
    tags: scoped("call-center", "/workspace/call-center"),
    source: "quality-fixture",
    createdAt: at,
  },
  {
    id: "cross-md-adopt",
    kind: "memory",
    text: "MD Adopt matches shelter pets using temperament and family preferences.",
    tags: scoped("md-adopt", "/workspace/md-adopt"),
    source: "quality-fixture",
    createdAt: at,
  },
  {
    id: "cross-elder-tv",
    kind: "memory",
    text: "Elder TV provides simplified remote controls and safe recovery for older viewers.",
    tags: scoped("elder-tv", "/workspace/elder-tv"),
    source: "quality-fixture",
    createdAt: at,
  },
  {
    id: "cross-co-ode",
    kind: "memory",
    text: "Co-ode review uses native macOS components and deterministic Scratchpad fixtures.",
    tags: scoped("co-ode", "/workspace/co-ode"),
    source: "quality-fixture",
    createdAt: at,
  },
  ...[
    ["global-evidence", "Memory reports should include visible evidence IDs and explicit abstention."],
    ["global-scope", "Automatic memory must preserve tenant and workspace isolation by default."],
    ["global-current-truth", "Current runtime evidence overrides stale historical memory."],
    ["global-no-send", "Never send messages or place calls without explicit authorization."],
    ["global-verification", "Implementation work ends with tests and active-installation verification."],
  ].map(([id, text]) => ({
    id,
    kind: "conclusion",
    text,
    tags: ["user-profile"],
    source: "quality-fixture",
    createdAt: at,
  })),
]);

const positiveCases = [
  ["/workspace/pathmark", "How does Pathmark expose visible evidence IDs and provenance?", "scoped-visible-evidence"],
  ["/workspace/pathmark", "Как русский ranking исключает нерелевантные проекты?", "scoped-russian-ranking"],
  ["/workspace/pathmark", "How do project scope and exact workspace handle worktrees?", "scoped-worktree-scope"],
  ["/workspace/pathmark", "Why are injected previews escaped as untrusted historical data?", "scoped-safe-preview"],
  ["/workspace/pathmark", "When should automatic recall abstain after scoped ranking?", "scoped-abstention"],
  ["/workspace/blank-one", "Recall the Meetily transcription local-first capture architecture.", "cross-meetily"],
  ["/workspace/blank-two", "What is the call-center Mexico calls daily schedule before 17:30?", "cross-call-center"],
  ["/workspace/blank-three", "How does md-adopt match shelter pets and temperament preferences?", "cross-md-adopt"],
  ["/workspace/blank-four", "What simplified remote controls does elder-tv provide older viewers?", "cross-elder-tv"],
  ["/workspace/blank-five", "How does co-ode use native macOS deterministic Scratchpad fixtures?", "cross-co-ode"],
  ["/workspace/global-one", "How should memory reports present visible evidence IDs and abstention?", "global-evidence"],
  ["/workspace/global-two", "What isolation should automatic memory preserve for tenant and workspace data?", "global-scope"],
  ["/workspace/global-three", "What overrides stale historical memory when reporting current runtime state?", "global-current-truth"],
  ["/workspace/global-four", "May an agent send messages or place calls without explicit authorization?", "global-no-send"],
  ["/workspace/global-five", "How should implementation finish with tests and installation verification?", "global-verification"],
];

for (const [cwd, query, expectedId] of positiveCases) {
  const output = await prompt({ cwd, session_id: `positive-${expectedId}`, prompt: query });
  assert.equal(output.includes(expectedId), true, `missed relevant memory ${expectedId}`);
}

const negativeQueries = [
  "Объясни фотосинтез простыми словами для школьника.",
  "Дай рецепт овощного супа без молочных продуктов.",
  "Как вычислить площадь треугольника по трём сторонам?",
  "Переведи фразу доброе утро на японский язык.",
  "Почему осенью листья меняют цвет?",
  "Составь пятидневный план ухода за комнатным кактусом.",
  "Какие созвездия видны в южном полушарии летом?",
  "Объясни разницу между скрипкой и альтом.",
  "Как правильно заваривать зелёный чай?",
  "Придумай три упражнения на растяжку после прогулки.",
  "Explain why ocean tides change during the month.",
  "Give me a simple sourdough starter feeding schedule.",
  "How do migratory birds navigate long distances?",
  "Translate good evening into Romanian.",
  "What causes a lunar eclipse?",
];

for (const [index, query] of negativeQueries.entries()) {
  const output = await prompt({
    cwd: `/workspace/no-memory-${index}`,
    session_id: `negative-${index}`,
    prompt: query,
  });
  assert.equal(output.includes("<pathmark-memory>"), false, `injected memory for no-memory query ${index + 1}`);
}

await closeOpenStores();
console.log(`Memory quality evaluation passed (${positiveCases.length} positive, ${negativeQueries.length} abstention cases)`);
