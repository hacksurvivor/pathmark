import { createHash, randomUUID } from "node:crypto";
import { redactSecrets } from "./redact.js";
import type { PathmarkStore } from "./store.js";
import type { PathmarkConfig, SearchResult } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

export async function recordMemoryQueryRecall(
  store: PathmarkStore,
  config: PathmarkConfig,
  query: string,
  results: SearchResult[],
  tags: string[] = [],
): Promise<string | undefined> {
  if (results.length === 0) return undefined;
  const at = new Date().toISOString();
  const id = randomUUID();
  await store.add({
    id,
    kind: "memory",
    text: `Pathmark chat recalled ${results.length} ${results.length === 1 ? "record" : "records"}.`,
    tags: normalizeTags([
      "pathmark-activity",
      "activity-recall",
      "role-tool",
      "channel-chat",
      ...tags,
      ...commonScopeTags(results),
    ]),
    source: "pathmark:chat",
    createdAt: at,
    updatedAt: at,
    ...(config.activityRetentionDays > 0
      ? { expiresAt: new Date(Date.parse(at) + config.activityRetentionDays * DAY_MS).toISOString() }
      : {}),
    activity: {
      type: "recall",
      queryHash: createHash("sha256").update(redactSecrets(query).text).digest("hex"),
      memoryIds: results.map((result) => result.record.id),
      memoryCount: results.length,
    },
  });
  await store.enforceActivityRetention({
    retentionDays: config.activityRetentionDays,
    maxRecords: config.activityMaxRecords,
  });
  return id;
}

export async function recordRecallFeedback(
  store: PathmarkStore,
  config: PathmarkConfig,
  input: { recallId: string; relevantIds?: string[]; irrelevantIds?: string[]; note?: string },
): Promise<Record<string, unknown>> {
  const recall = await store.get(input.recallId.trim());
  if (!recall || recall.activity?.type !== "recall") throw new Error(`Recall activity not found: ${input.recallId}`);

  const relevantIds = normalizeIds(input.relevantIds ?? []);
  const irrelevantIds = normalizeIds(input.irrelevantIds ?? []);
  if (relevantIds.length === 0 && irrelevantIds.length === 0) {
    throw new Error("Feedback requires at least one relevant or irrelevant memory id");
  }
  const overlap = relevantIds.find((id) => irrelevantIds.includes(id));
  if (overlap) throw new Error(`Memory cannot be both relevant and irrelevant: ${overlap}`);

  const recalledIds = new Set(recall.activity.memoryIds);
  for (const id of [...relevantIds, ...irrelevantIds]) {
    if (!recalledIds.has(id)) throw new Error(`Memory ${id} was not part of recall ${recall.id}`);
  }

  const at = new Date().toISOString();
  const id = randomUUID();
  const note = input.note?.trim() ? redactSecrets(input.note.trim()).text.slice(0, 1_000) : undefined;
  await store.add({
    id,
    kind: "memory",
    text: `Pathmark recall feedback: ${relevantIds.length} relevant, ${irrelevantIds.length} irrelevant.`,
    tags: normalizeTags([
      "pathmark-activity",
      "activity-recall-feedback",
      "role-tool",
      ...recall.tags.filter(
        (tag) =>
          tag !== "pathmark-activity" &&
          !tag.startsWith("activity-") &&
          !tag.startsWith("role-") &&
          !tag.startsWith("channel-"),
      ),
    ]),
    source: "pathmark:feedback",
    createdAt: at,
    updatedAt: at,
    ...(config.activityRetentionDays > 0
      ? { expiresAt: new Date(Date.parse(at) + config.activityRetentionDays * DAY_MS).toISOString() }
      : {}),
    activity: {
      type: "recall_feedback",
      recallId: recall.id,
      relevantIds,
      irrelevantIds,
      ...(note ? { note } : {}),
    },
  });
  await store.enforceActivityRetention({
    retentionDays: config.activityRetentionDays,
    maxRecords: config.activityMaxRecords,
  });
  return { feedbackId: id, recallId: recall.id, relevantIds, irrelevantIds, ...(note ? { note } : {}) };
}

function normalizeIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, 30);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
}

function commonScopeTags(results: SearchResult[]): string[] {
  if (results.length === 0) return [];
  const scopes = results.map((result) =>
    new Set(result.record.tags.filter((tag) => /^(?:namespace|workspace|project):/.test(tag))),
  );
  return [...scopes[0]].filter((tag) => scopes.slice(1).every((scope) => scope.has(tag)));
}
