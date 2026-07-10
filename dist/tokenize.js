const WORD_RE = /[\p{L}\p{N}_'-]+/gu;
const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
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
    if ([...term].length > 1 || isCjkSearchTerm(term))
        terms.add(term);
}
//# sourceMappingURL=tokenize.js.map