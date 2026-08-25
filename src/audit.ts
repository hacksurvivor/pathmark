import { conclusionApprovalStatus } from "./approval.js";
import type { PathmarkStore } from "./store.js";
import type { PathmarkRecord } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface MemoryAuditOptions {
  days?: number;
  tags?: string[];
  rawRecallDays?: number;
  rawRecallLimit?: number;
  now?: Date;
}

export async function auditMemory(store: PathmarkStore, options: MemoryAuditOptions = {}): Promise<Record<string, unknown>> {
  const now = options.now ?? new Date();
  const days = Math.max(0, Math.min(options.days ?? 30, 3_650));
  const rawRecallDays = Math.max(0, Math.min(options.rawRecallDays ?? 30, 3_650));
  const rawRecallLimit = Math.max(0, Math.min(options.rawRecallLimit ?? 2, 2));
  const tags = [...new Set((options.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  const windowStartMs = days > 0 ? now.getTime() - days * DAY_MS : undefined;
  const allActive = await store.all();
  const selected = allActive.filter((record) => tags.every((tag) => record.tags.includes(tag)));
  const selectedIds = new Set(selected.map((record) => record.id));
  const allById = new Map(allActive.map((record) => [record.id, record]));
  const eligible = selected.filter((record) => !isActivity(record));
  const rawEvidence = eligible.filter((record) => record.kind === "memory");
  const conclusions = eligible.filter((record) => record.kind === "conclusion");
  const recallEvents = selected
    .filter((record) => record.activity?.type === "recall")
    .filter((record) => inWindow(record.createdAt, windowStartMs))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const references = recallEvents.flatMap((event) =>
    event.activity?.type === "recall"
      ? event.activity.memoryIds.map((id) => ({ event, id, record: allById.get(id) }))
      : [],
  );
  const scopedReferences = references.filter((reference) => selectedIds.has(reference.id));
  const recalledIds = new Set(scopedReferences.map((reference) => reference.id));
  const createdInWindow = eligible.filter((record) => inWindow(record.createdAt, windowStartMs));
  const recalledCreatedInWindow = createdInWindow.filter((record) => recalledIds.has(record.id));
  const ages = scopedReferences
    .map((reference) => referenceAgeDays(reference.event, reference.record))
    .filter((age): age is number => age !== undefined)
    .sort((left, right) => left - right);
  const rawReferences = scopedReferences.filter((reference) => reference.record?.kind === "memory");
  const staleRawReferences = rawReferences.filter((reference) => {
    const age = referenceAgeDays(reference.event, reference.record);
    return age !== undefined && (rawRecallDays === 0 || age > rawRecallDays);
  });
  const duplicateRecords = countExactDuplicates(eligible);
  const firstRecallAt = recallEvents.at(0)?.createdAt ?? null;
  const lastRecallAt = recallEvents.at(-1)?.createdAt ?? null;

  return {
    generatedAt: now.toISOString(),
    scope: { tags },
    window: {
      days,
      start: windowStartMs === undefined ? null : new Date(windowStartMs).toISOString(),
      firstRecallAt,
      lastRecallAt,
    },
    policy: {
      rawArchiveSearchable: true,
      proactiveOrder: ["approved_conclusion", "fresh_scoped_raw_fallback"],
      rawRecallDays,
      rawRecallLimit,
    },
    inventory: {
      activeRecords: selected.length,
      rawEvidenceRecords: rawEvidence.length,
      activityRecords: selected.filter(isActivity).length,
      approvedConclusions: conclusions.filter((record) => conclusionApprovalStatus(record) === "approved").length,
      pendingConclusions: conclusions.filter((record) => conclusionApprovalStatus(record) === "pending").length,
      rejectedConclusions: conclusions.filter((record) => conclusionApprovalStatus(record) === "rejected").length,
      exactDuplicateRecords: duplicateRecords,
      exactDuplicateRate: ratio(duplicateRecords, eligible.length),
    },
    recall: {
      events: recallEvents.length,
      totalReferences: references.length,
      scopedReferences: scopedReferences.length,
      outOfScopeReferences: references.filter((reference) => reference.record && !selectedIds.has(reference.id)).length,
      missingReferences: references.filter((reference) => !reference.record).length,
      uniqueRecalledRecords: recalledIds.size,
      notRecalledInWindow: eligible.filter((record) => !recalledIds.has(record.id)).length,
      recallCoverage: ratio(recalledIds.size, eligible.length),
      recordsCreatedInWindow: createdInWindow.length,
      createdAndRecalledInWindow: recalledCreatedInWindow.length,
      newRecordRecallCoverage: ratio(recalledCreatedInWindow.length, createdInWindow.length),
      capturesPerRecallEvent: ratio(createdInWindow.length, recallEvents.length),
      approvedConclusionReferences: scopedReferences.filter((reference) => reference.record?.kind === "conclusion").length,
      rawEvidenceReferences: rawReferences.length,
      staleRawReferences: staleRawReferences.length,
      staleRawHitRate: ratio(staleRawReferences.length, rawReferences.length),
      ageDays: {
        mean: ages.length > 0 ? round(ages.reduce((total, age) => total + age, 0) / ages.length) : null,
        median: percentile(ages, 0.5),
        p95: percentile(ages, 0.95),
      },
    },
    precision: {
      status: "unlabeled",
      value: null,
      reason:
        "Recall activity records which ids were injected, but no user relevance labels exist. Stale, duplicate, missing, and coverage signals are reported without pretending they are precision.",
    },
  };
}

function isActivity(record: PathmarkRecord): boolean {
  return record.tags.includes("pathmark-activity") || record.activity !== undefined;
}

function inWindow(value: string, windowStartMs: number | undefined): boolean {
  if (windowStartMs === undefined) return true;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= windowStartMs;
}

function referenceAgeDays(event: PathmarkRecord, record: PathmarkRecord | undefined): number | undefined {
  if (!record) return undefined;
  const eventAt = Date.parse(event.createdAt);
  const recordAt = Date.parse(record.updatedAt || record.createdAt);
  if (!Number.isFinite(eventAt) || !Number.isFinite(recordAt)) return undefined;
  return Math.max(0, eventAt - recordAt) / DAY_MS;
}

function countExactDuplicates(records: PathmarkRecord[]): number {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = JSON.stringify([record.kind, record.text.trim(), [...record.tags].sort(), record.source]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round(numerator / denominator) : null;
}

function percentile(sorted: number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return round(sorted[index]);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
