import { z } from "zod";
export const predicateSchema = z.object({
    field: z.string().min(1).max(120),
    operator: z.enum(["eq", "neq", "includes", "not-includes", "lte", "gte"]),
    value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
    explanation: z.string().min(1).max(1000),
});
export const decisionSchema = z.object({
    rationale: z.string().min(1).max(4000),
    alternatives: z.array(z.string().min(1).max(1000)).max(20).default([]),
    assumptions: z.array(predicateSchema).max(20).default([]),
    checks: z.array(predicateSchema).min(1).max(30),
    owner: z.string().min(1).max(200),
    reviewAfter: z.string().datetime().optional(),
});
export const dispositionSchema = z.object({
    status: z.enum(["incorporated", "duplicate", "temporary", "rejected", "needs-review"]),
    revision: z.string().min(1),
    reviewedAt: z.string().datetime(),
    reviewedBy: z.string().min(1).max(200),
    note: z.string().max(1000).optional(),
});
//# sourceMappingURL=decision-schema.js.map