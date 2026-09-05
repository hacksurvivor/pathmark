export const SCOPE_PREFIXES = ["workspace:", "project:", "project-id:", "namespace:", "session:"];
export const isScopeTag = (tag) => SCOPE_PREFIXES.some((prefix) => tag.startsWith(prefix));
export async function loadScopeEvidence(store, records) {
    return store.getMany([...new Set(records.flatMap((record) => record.evidenceIds ?? []))], { includeDeleted: true });
}
export function effectiveTags(record, evidence) {
    if (record.kind !== "conclusion" || !record.evidenceIds?.length)
        return record.tags;
    const sources = record.evidenceIds.map((id) => evidence.get(id));
    if (sources.some((item) => !item || item.kind !== "memory"))
        return [...record.tags, "scope-unresolved"];
    const shared = sources[0].tags.filter((tag) => isScopeTag(tag) && sources.every((item) => item.tags.includes(tag)));
    if (!shared.length && sources.some((item) => item.tags.some(isScopeTag)) && !record.tags.some(isScopeTag))
        return [...record.tags, "scope-unresolved"];
    return [...new Set([...record.tags, ...shared])];
}
export function matchesEffectiveTags(record, required, evidence) {
    const tags = effectiveTags(record, evidence);
    return required.every((tag) => tags.includes(tag));
}
// A display label cannot override a conflicting stable project/workspace identity.
export function appliesToScope(record, requested, evidence) {
    const tags = effectiveTags(record, evidence);
    if (tags.includes("scope-unresolved"))
        return false;
    const namespaces = tags.filter((tag) => tag.startsWith("namespace:"));
    if (namespaces.length && !namespaces.some((tag) => requested.includes(tag)))
        return false;
    const projectIds = tags.filter((tag) => tag.startsWith("project-id:"));
    if (projectIds.length)
        return projectIds.some((tag) => requested.includes(tag));
    const workspaces = tags.filter((tag) => tag.startsWith("workspace:"));
    if (workspaces.length)
        return workspaces.some((tag) => requested.includes(tag));
    const projects = tags.filter((tag) => tag.startsWith("project:"));
    if (projects.length)
        return !requested.some((tag) => tag.startsWith("workspace:")) && projects.some((tag) => requested.includes(tag));
    const sessions = tags.filter((tag) => tag.startsWith("session:"));
    if (sessions.length)
        return sessions.some((tag) => requested.includes(tag));
    return true;
}
//# sourceMappingURL=scope.js.map