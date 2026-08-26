import { conclusionApprovalStatus } from "./approval.js";
import { isConsolidationEvidence } from "./consolidate.js";
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
  const consolidationEvidence = rawEvidence.filter(isConsolidationEvidence);
  const consolidationEvidenceIds = new Set(consolidationEvidence.map((record) => record.id));
  const conclusions = eligible.filter((record) => record.kind === "conclusion");
  const synthesisEligibleConclusions = conclusions.filter(
    (record) => conclusionApprovalStatus(record) !== "rejected" && (record.evidenceIds?.length ?? 0) > 0,
  );
  const evidenceReferences = synthesisEligibleConclusions.flatMap((record) => record.evidenceIds ?? []);
  const referencedEvidenceIds = new Set(evidenceReferences.filter((id) => selectedIds.has(id)));
  const referencedConsolidationEvidenceIds = new Set(
    evidenceReferences.filter((id) => consolidationEvidenceIds.has(id)),
  );
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
  const feedback = recallFeedback(selected, allById, selectedIds, windowStartMs);
  const unprocessedEligibleEvidenceRecords = consolidationEvidence.filter(
    (record) => !referencedConsolidationEvidenceIds.has(record.id),
  ).length;
  const eligibleEvidenceConclusionCoverage = ratio(
    referencedConsolidationEvidenceIds.size,
    consolidationEvidence.length,
  );

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
      evidenceBackedConclusions: synthesisEligibleConclusions.length,
      consolidationEligibleRawEvidenceRecords: consolidationEvidence.length,
      excludedFromConsolidationRecords: rawEvidence.length - consolidationEvidence.length,
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
    synthesis: {
      evidenceReferences: evidenceReferences.length,
      uniqueEvidenceReferenced: referencedEvidenceIds.size,
      missingEvidenceReferences: evidenceReferences.filter((id) => !allById.has(id)).length,
      unprocessedRawEvidenceRecords: unprocessedEligibleEvidenceRecords,
      unprocessedEligibleEvidenceRecords,
      rawEvidenceConclusionCoverage: eligibleEvidenceConclusionCoverage,
      eligibleEvidenceConclusionCoverage,
    },
    precision:
      feedback.labeledReferences > 0
        ? {
            status: "labeled",
            value: ratio(feedback.relevantReferences, feedback.labeledReferences),
            labeledRecallEvents: feedback.labeledRecallEvents,
            labeledReferences: feedback.labeledReferences,
            relevantReferences: feedback.relevantReferences,
            irrelevantReferences: feedback.irrelevantReferences,
            labelCoverage: ratio(feedback.labeledReferences, scopedReferences.length),
          }
        : {
            status: "unlabeled",
            value: null,
            labeledRecallEvents: 0,
            labeledReferences: 0,
            relevantReferences: 0,
            irrelevantReferences: 0,
            labelCoverage: 0,
            reason:
              "Recall activity records which ids were injected, but no user relevance labels exist. Use rate_recall or pathmark feedback to label exact recalled ids.",
          },
  };
}

function recallFeedback(
  selected: PathmarkRecord[],
  allById: Map<string, PathmarkRecord>,
  selectedIds: Set<string>,
  windowStartMs: number | undefined,
): {
  labeledRecallEvents: number;
  labeledReferences: number;
  relevantReferences: number;
  irrelevantReferences: number;
} {
  const labels = new Map<string, { recallId: string; relevant: boolean }>();
  for (const record of selected
    .filter((candidate) => candidate.activity?.type === "recall_feedback")
    .filter((candidate) => inWindow(candidate.createdAt, windowStartMs))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (record.activity?.type !== "recall_feedback") continue;
    const recall = allById.get(record.activity.recallId);
    if (recall?.activity?.type !== "recall") continue;
    const recalledIds = new Set(recall.activity.memoryIds);
    for (const id of record.activity.relevantIds) {
      if (recalledIds.has(id) && selectedIds.has(id)) labels.set(`${recall.id}\0${id}`, { recallId: recall.id, relevant: true });
    }
    for (const id of record.activity.irrelevantIds) {
      if (recalledIds.has(id) && selectedIds.has(id)) labels.set(`${recall.id}\0${id}`, { recallId: recall.id, relevant: false });
    }
  }
  const values = [...labels.values()];
  return {
    labeledRecallEvents: new Set(values.map((label) => label.recallId)).size,
    labeledReferences: values.length,
    relevantReferences: values.filter((label) => label.relevant).length,
    irrelevantReferences: values.filter((label) => !label.relevant).length,
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
