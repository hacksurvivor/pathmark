import { tokenizeSearchText } from "./tokenize.js";
const GENERIC_TERMS = new Set([
    "agent",
    "assistant",
    "codex",
    "coding",
    "decision",
    "decisions",
    "document",
    "documents",
    "home",
    "immediate",
    "memory",
    "memories",
    "preferences",
    "project",
    "prompt",
    "recall",
    "role",
    "session",
    "solution",
    "solutions",
    "system",
    "systems",
    "thread",
    "user",
    "workspace",
]);
const LOW_INFORMATION_TERMS = new Set([
    "check",
    "fine",
    "fix",
    "good",
    "need",
    "okay",
    "please",
    "pls",
    "ready",
    "sure",
    "totally",
    "well",
    "важно",
    "допустим",
    "другие",
    "других",
    "безупречно",
    "круто",
    "можем",
    "можешь",
    "наша",
    "нужен",
    "нужна",
    "нужно",
    "нужны",
    "передовых",
    "передовые",
    "пожалуйста",
    "позаимствовать",
    "посмотреть",
    "работает",
    "решение",
    "решения",
    "система",
    "системы",
    "также",
    "убедись",
    "убедиться",
    "варианты",
    "хватает",
    "хорошо",
    "ошибок",
]);
const ENGLISH_STOP_WORDS = new Set("a about after all also an and are as at be because before both but by can could did do does each for from had has have how i if in into is it its may more most my no not of on one only or our out over same should so some than that the their them then there these they this those through to up use was we were what when where which while who will with without would you your".split(" "));
const RUSSIAN_STOP_WORDS = new Set("а без более был была были было быть бы в вам вас ведь весь во вот все всего всех вы где да даже для до его ее если есть еще же за зачем здесь и из или им их к как когда конечно которые который которая которое которых кто ли между меня мне много может мой мы на надо над нам нами нас не него нее нет ни них но ну о об один он она они от очень перед по под после потому почти при про раз разве сам себя со с так такой там тебя тем то того тоже только том тот тут ты у уже хоть чего чем через что что-то чтобы этот этого этой эти это я".split(" "));
const METADATA_TERM = /^(?:[0-9a-f]{4,}|\d{4,})$/i;
const NEAR_DUPLICATE_CONTAINMENT = 0.82;
const RELATIVE_RELEVANCE_CUTOFF = 0.6;
export function selectRelevantResults(results, query, limit, options = {}) {
    if (results.length === 0 || limit <= 0)
        return [];
    const queryTerms = informativeSearchTerms(query);
    const signalResults = filterLowSignalResults(results);
    if (queryTerms.size === 0)
        return [];
    const queryWeight = [...queryTerms].reduce((total, term) => total + termWeight(term), 0);
    const defaultRequiredMatches = Math.min(3, Math.max(1, Math.ceil(queryTerms.size * 0.34)));
    const cappedRequiredMatches = Math.min(defaultRequiredMatches, Math.max(1, options.maxRequiredMatches ?? defaultRequiredMatches));
    const requiredMatches = Math.min(queryTerms.size, Math.max(cappedRequiredMatches, Math.max(1, options.minRequiredMatches ?? 1)));
    const minCoverage = Math.max(0, Math.min(options.minCoverage ?? 0, 1));
    const ranked = signalResults
        .map((result) => {
        const textTerms = informativeSearchTerms(result.record.text);
        const scopeTerms = informativeSearchTerms(result.record.tags.filter((tag) => tag.startsWith("project:") || tag.startsWith("namespace:")).join(" "));
        const terms = new Set([...textTerms, ...scopeTerms]);
        const matched = [...queryTerms].filter((term) => terms.has(term));
        const matchWeight = matched.reduce((total, term) => total + termWeight(term), 0);
        const coverage = queryWeight > 0 ? matchWeight / queryWeight : 0;
        return {
            result,
            relevance: terms.size === 0 ? 0 : coverage * 100 + matchWeight / Math.sqrt(terms.size),
            coverage,
            matchedCount: matched.length,
            scopeMatches: [...queryTerms].filter((term) => scopeTerms.has(term)).length,
            terms,
        };
    })
        .filter((candidate) => candidate.relevance > 0 && candidate.matchedCount >= requiredMatches && candidate.coverage >= minCoverage)
        .sort((a, b) => b.scopeMatches - a.scopeMatches ||
        b.coverage - a.coverage ||
        b.matchedCount - a.matchedCount ||
        b.relevance - a.relevance ||
        b.result.score - a.result.score ||
        b.result.record.createdAt.localeCompare(a.result.record.createdAt));
    if (ranked.length === 0)
        return [];
    const cutoff = ranked[0].relevance * RELATIVE_RELEVANCE_CUTOFF;
    const selected = [];
    for (const candidate of ranked) {
        const durable = candidate.result.record.kind === "conclusion" ||
            candidate.result.record.tags.includes("decision") ||
            candidate.result.record.tags.includes("project-note");
        if (candidate.relevance < cutoff && !durable)
            continue;
        if (selected.some((existing) => nearDuplicate(existing.terms, candidate.terms, existing.result.record.text, candidate.result.record.text))) {
            continue;
        }
        selected.push(candidate);
        if (selected.length >= limit)
            break;
    }
    return selected.map((candidate) => candidate.result);
}
export function filterLowSignalResults(results) {
    return results.filter((result) => !isLowSignalCapture(result));
}
function isLowSignalCapture(result) {
    const text = result.record.text.trimStart();
    if (/^(?:#\s*(?:files mentioned by the user|response annotations|diff comments):|#\s*overview\s+generate\s+0\s+to\s+3\s+hyperpersonalized\s+suggestions\b|<(?:recommended_plugins|subagent_notification|codex_internal_context|pathmark-memory|environment_context|realtime_delegation|skill)\b)/i.test(text)) {
        return true;
    }
    if (!result.record.tags.includes("role-assistant"))
        return false;
    return /^(?:i(?:['’]m| am)\s+(?:starting|checking|verifying|running|opening|reviewing|tracing|testing)|i['’]ll\s+(?:check|verify|run|inspect|open|review|trace|test|start|audit|compare|update|fix))\b/i.test(text);
}
function termWeight(term) {
    return Math.min([...term].length, 12);
}
function nearDuplicate(left, right, leftText, rightText) {
    if (left.size === 0 || right.size === 0)
        return false;
    let intersection = 0;
    for (const term of left) {
        if (right.has(term))
            intersection += 1;
    }
    if (intersection / Math.min(left.size, right.size) >= NEAR_DUPLICATE_CONTAINMENT)
        return true;
    const normalizedLeft = normalizeText(leftText);
    const normalizedRight = normalizeText(rightText);
    const shortestLength = Math.min(normalizedLeft.length, normalizedRight.length);
    if (shortestLength < 400)
        return false;
    let commonPrefix = 0;
    while (commonPrefix < shortestLength && normalizedLeft[commonPrefix] === normalizedRight[commonPrefix]) {
        commonPrefix += 1;
    }
    return commonPrefix >= 400 && commonPrefix / shortestLength >= 0.5;
}
export function informativeSearchTerms(text) {
    return new Set(tokenizeSearchText(text).filter((term) => !GENERIC_TERMS.has(term) &&
        !LOW_INFORMATION_TERMS.has(term) &&
        !ENGLISH_STOP_WORDS.has(term) &&
        !RUSSIAN_STOP_WORDS.has(term) &&
        !METADATA_TERM.test(term)));
}
function normalizeText(text) {
    return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
//# sourceMappingURL=relevance.js.map