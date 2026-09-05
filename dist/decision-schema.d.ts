import { z } from "zod";
export declare const predicateSchema: z.ZodObject<{
    field: z.ZodString;
    operator: z.ZodEnum<["eq", "neq", "includes", "not-includes", "lte", "gte"]>;
    value: z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    explanation: z.ZodString;
}, "strip", z.ZodTypeAny, {
    field: string;
    operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
    value: string | number | boolean;
    explanation: string;
}, {
    field: string;
    operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
    value: string | number | boolean;
    explanation: string;
}>;
export declare const decisionSchema: z.ZodObject<{
    rationale: z.ZodString;
    alternatives: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    assumptions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        operator: z.ZodEnum<["eq", "neq", "includes", "not-includes", "lte", "gte"]>;
        value: z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>;
        explanation: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        field: string;
        operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
        value: string | number | boolean;
        explanation: string;
    }, {
        field: string;
        operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
        value: string | number | boolean;
        explanation: string;
    }>, "many">>;
    checks: z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        operator: z.ZodEnum<["eq", "neq", "includes", "not-includes", "lte", "gte"]>;
        value: z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>;
        explanation: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        field: string;
        operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
        value: string | number | boolean;
        explanation: string;
    }, {
        field: string;
        operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
        value: string | number | boolean;
        explanation: string;
    }>, "many">;
    owner: z.ZodString;
    reviewAfter: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    rationale: string;
    alternatives: string[];
    assumptions: {
        field: string;
        operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
        value: string | number | boolean;
        explanation: string;
    }[];
    checks: {
        field: string;
        operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
        value: string | number | boolean;
        explanation: string;
    }[];
    owner: string;
    reviewAfter?: string | undefined;
}, {
    rationale: string;
    checks: {
        field: string;
        operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
        value: string | number | boolean;
        explanation: string;
    }[];
    owner: string;
    alternatives?: string[] | undefined;
    assumptions?: {
        field: string;
        operator: "includes" | "eq" | "neq" | "not-includes" | "lte" | "gte";
        value: string | number | boolean;
        explanation: string;
    }[] | undefined;
    reviewAfter?: string | undefined;
}>;
export declare const dispositionSchema: z.ZodObject<{
    status: z.ZodEnum<["incorporated", "duplicate", "temporary", "rejected", "needs-review"]>;
    revision: z.ZodString;
    reviewedAt: z.ZodString;
    reviewedBy: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "incorporated" | "duplicate" | "temporary" | "rejected" | "needs-review";
    revision: string;
    reviewedAt: string;
    reviewedBy: string;
    note?: string | undefined;
}, {
    status: "incorporated" | "duplicate" | "temporary" | "rejected" | "needs-review";
    revision: string;
    reviewedAt: string;
    reviewedBy: string;
    note?: string | undefined;
}>;
