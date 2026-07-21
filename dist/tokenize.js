const WORD_RE = /[\p{L}\p{N}_'-]+/gu;
const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const SEARCH_ALIASES = {
    architectures: ["design"],
    architecture: ["design"],
    calls: ["call"],
    chose: ["selection"],
    choose: ["selection"],
    chosen: ["selection"],
    commands: ["command"],
    contacts: ["contact"],
    databases: ["database"],
    decided: ["selection"],
    decide: ["selection"],
    designs: ["design"],
    leads: ["lead"],
    memories: ["memory"],
    mongodb: ["database"],
    mysql: ["database"],
    postgres: ["database"],
    postgresql: ["database"],
    processed: ["process"],
    processing: ["process"],
    prompts: ["prompt"],
    results: ["result"],
    selected: ["selection"],
    selects: ["selection"],
    showed: ["show"],
    showing: ["show"],
    shown: ["show"],
    sqlite: ["database"],
    stt: ["transcription"],
    supabase: ["database"],
    tools: ["tool"],
    transcript: ["transcription"],
    transcripts: ["transcription"],
    transcriber: ["transcription"],
    transcribers: ["transcription"],
    whisper: ["transcription"],
};
export function tokenizeSearchText(text) {
    const normalized = text.normalize("NFKC").toLowerCase();
    const terms = new Set();
    for (const match of normalized.matchAll(WORD_RE)) {
        addTerm(terms, match[0]);
        for (const part of match[0].split(/[-']+/))
            addTerm(terms, part);
    }
    for (const match of normalized.matchAll(CJK_RUN_RE)) {
        const characters = [...match[0]];
        for (const width of [2, 3]) {
            for (let index = 0; index + width <= characters.length; index += 1) {
                addTerm(terms, characters.slice(index, index + width).join(""));
            }
        }
    }
    return [...terms];
}
export function isCjkSearchTerm(term) {
    return CJK_CHAR_RE.test(term);
}
function addTerm(terms, value) {
    const term = value.trim();
    if (!term)
        return;
    if ([...term].length > 1 || isCjkSearchTerm(term)) {
        terms.add(term);
        const aliases = Object.hasOwn(SEARCH_ALIASES, term) ? SEARCH_ALIASES[term] : undefined;
        for (const alias of aliases ?? [])
            terms.add(alias);
    }
}
//# sourceMappingURL=tokenize.js.map