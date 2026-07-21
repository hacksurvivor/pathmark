import { createHash, randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { tokenizeSearchText } from "./tokenize.js";
import { rerankWithCommand } from "./retrieval.js";
import { encryptPortableExport } from "./portable.js";
const DEFAULT_LOCK_RETRY_MS = 10;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_INDEX_LOCK_TIMEOUT_MS = 120000;
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;
const DEFAULT_NO_OWNER_STALE_LOCK_MS = 5000;
const LOCK_OWNER_FILE = "owner.json";
const WRITE_LOCK_DIR = ".memory.lock";
const INDEX_LOCK_DIR = ".memory.index.lock";
const INDEX_SCHEMA_VERSION = "4";
const INDEX_FILE = `memory.index.v${INDEX_SCHEMA_VERSION}.sqlite`;
const SEARCH_CANDIDATE_LIMIT = 2000;
const ACTIVITY_TAG = "pathmark-activity";
const ACTIVITY_PRUNE_INTERVAL_MS = 60 * 60 * 1_000;
const ACTIVITY_PRUNED_AT_KEY = "activity_pruned_at_ms";
export class PathmarkStore {
    config;
    db;
    syncPromise;
    constructor(config) {
        this.config = config;
    }
    async ensureReady() {
        await mkdir(this.config.storeDir, { recursive: true });
        await appendFile(this.config.memoryFile, "", "utf8");
    }
    async add(input, options = {}) {
        const { record } = await this.addRecord(input, options);
        return record;
    }
    async addRecord(input, options = {}) {
        const [result] = await this.addRecords([input], options);
        return result;
    }
    async addRecords(inputs, options = {}) {
        await this.ensureReady();
        const now = new Date().toISOString();
        const drafts = inputs.map((input) => {
            const normalizedText = input.text.trim();
            if (!normalizedText)
                throw new Error("text is required");
            return { input, normalizedText };
        });
        return this.withWriteLock(async () => {
            const db = await this.database();
            if (options.backupFile) {
                await mkdir(path.dirname(options.backupFile), { recursive: true });
                await copyFile(this.config.memoryFile, options.backupFile);
            }
            const findRecord = db.prepare("SELECT * FROM records WHERE id = ?");
            const findDuplicate = options.dedupe
                ? db.prepare("SELECT * FROM records WHERE content_hash = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1")
                : undefined;
            const results = [];
            const createdRecords = [];
            const pending = new Map();
            const pendingHashes = new Map();
            for (const { input, normalizedText } of drafts) {
                const id = input.id?.trim() || randomUUID();
                const pendingRecord = pending.get(id);
                if (pendingRecord) {
                    results.push({ record: pendingRecord, created: false });
                    continue;
                }
                const existing = findRecord.get(id);
                if (existing) {
                    results.push({ record: rowToRecord(existing), created: false });
                    continue;
                }
                const record = {
                    id,
                    kind: input.kind,
                    text: normalizedText,
                    tags: normalizeTags(input.tags ?? []),
                    source: input.source?.trim() || "mcp",
                    createdAt: input.createdAt ?? now,
                    updatedAt: input.updatedAt ?? input.createdAt ?? now,
                    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
                    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
                    ...(input.activity ? { activity: input.activity } : {}),
                };
                if (findDuplicate) {
                    const hash = contentHash(record);
                    const pendingDuplicate = pendingHashes.get(hash);
                    if (pendingDuplicate) {
                        results.push({ record: pendingDuplicate, created: false });
                        continue;
                    }
                    const duplicate = findDuplicate.get(hash);
                    if (duplicate) {
                        results.push({ record: rowToRecord(duplicate), created: false });
                        continue;
                    }
                    pendingHashes.set(hash, record);
                }
                pending.set(id, record);
                createdRecords.push(record);
                results.push({ record, created: true });
            }
            await this.appendMany(createdRecords);
            if (createdRecords.length > 0) {
                indexRecords(db, createdRecords);
                await updateIndexMetadata(db, this.config.memoryFile, currentInvalidRecordCount(db));
            }
            return results;
        });
    }
    async all(options = {}) {
        const db = await this.database();
        const clauses = [];
        const parameters = [];
        if (!options.includeDeleted) {
            clauses.push("deleted_at IS NULL");
            clauses.push("(expires_at IS NULL OR expires_at > ?)");
            parameters.push(new Date().toISOString());
        }
        if (options.kind) {
            clauses.push("kind = ?");
            parameters.push(options.kind);
        }
        const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
        const rows = db.prepare(`SELECT * FROM records${where} ORDER BY created_at DESC`).all(...parameters);
        return rows.map(rowToRecord);
    }
    async count() {
        const db = await this.database();
        const row = db.prepare("SELECT COUNT(*) AS count FROM records").get();
        return Number(row.count);
    }
    async recordsWithTags(tags, options = {}) {
        const db = await this.database();
        const tagFilter = normalizeTags(tags);
        const { sql: filterSql, parameters } = recordFilters({ tagFilter, kind: options.kind });
        const limit = Math.max(1, Math.min(options.limit ?? 5000, 10_000));
        const rows = db
            .prepare(`SELECT records.* FROM records WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)${filterSql} ORDER BY created_at DESC LIMIT ?`)
            .all(new Date().toISOString(), ...parameters, limit);
        return rows.map(rowToRecord);
    }
    async enforceActivityRetention(options) {
        const retentionDays = Math.max(0, options.retentionDays);
        const maxRecords = Math.max(0, Math.min(options.maxRecords, 100_000));
        const db = await this.database();
        const now = Date.now();
        const lastPrunedAt = Number.parseInt(getMeta(db, ACTIVITY_PRUNED_AT_KEY) ?? "0", 10);
        const countRow = db
            .prepare("SELECT COUNT(*) AS count FROM records WHERE instr(tags_key, ?) > 0")
            .get(`\u001f${ACTIVITY_TAG}\u001f`);
        const count = Number(countRow.count);
        const overLimit = maxRecords > 0 && count > maxRecords;
        const due = !Number.isFinite(lastPrunedAt) || now - lastPrunedAt >= ACTIVITY_PRUNE_INTERVAL_MS;
        if (!overLimit && !due)
            return { applied: false, removedRecords: 0 };
        return this.withWriteLock(async () => {
            const raw = await readFile(this.config.memoryFile, "utf8");
            const parsed = parseJsonl(raw);
            const cutoff = retentionDays > 0 ? now - retentionDays * 24 * 60 * 60 * 1_000 : undefined;
            const eligible = parsed.records
                .filter((record) => record.tags.includes(ACTIVITY_TAG))
                .filter((record) => !record.deletedAt)
                .filter((record) => !record.expiresAt || Date.parse(record.expiresAt) > now)
                .filter((record) => cutoff === undefined || Date.parse(record.createdAt) >= cutoff)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            const retained = new Set((maxRecords > 0 ? eligible.slice(0, maxRecords) : eligible).map((record) => record.id));
            const removedIds = new Set(parsed.records
                .filter((record) => record.tags.includes(ACTIVITY_TAG) && !retained.has(record.id))
                .map((record) => record.id));
            if (removedIds.size === 0) {
                setMeta(db, ACTIVITY_PRUNED_AT_KEY, String(now));
                return { applied: false, removedRecords: 0 };
            }
            const lines = raw.split("\n").filter((line) => {
                if (!line.trim())
                    return false;
                const record = parseRecordLine(line);
                return !record || !removedIds.has(record.id);
            });
            const tmp = path.join(this.config.storeDir, `.memory.activity-retention.${randomUUID()}.tmp`);
            await writeFile(tmp, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
            await rename(tmp, this.config.memoryFile);
            const kept = parsed.records.filter((record) => !removedIds.has(record.id));
            replaceIndexRecords(db, kept);
            await updateIndexMetadata(db, this.config.memoryFile, parsed.invalidRecordCount);
            setMeta(db, ACTIVITY_PRUNED_AT_KEY, String(now));
            return { applied: true, removedRecords: removedIds.size };
        });
    }
    async health() {
        const db = await this.database();
        return {
            indexFile: this.indexFile,
            invalidRecordCount: currentInvalidRecordCount(db),
        };
    }
    async delete(id) {
        await this.ensureReady();
        return this.withWriteLock(async () => {
            const db = await this.database();
            const row = db.prepare("SELECT * FROM records WHERE id = ? AND deleted_at IS NULL").get(id);
            if (!row)
                return undefined;
            const existing = rowToRecord(row);
            const now = new Date().toISOString();
            const deleted = { ...existing, deletedAt: now, updatedAt: now };
            await this.rewriteRecord(id, deleted);
            indexRecords(db, [deleted]);
            await updateIndexMetadata(db, this.config.memoryFile, currentInvalidRecordCount(db));
            return deleted;
        });
    }
    async deleteMany(ids) {
        const selectedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
        if (selectedIds.length === 0)
            return 0;
        await this.ensureReady();
        return this.withWriteLock(async () => {
            const db = await this.database();
            const find = db.prepare("SELECT * FROM records WHERE id = ? AND deleted_at IS NULL");
            const now = new Date().toISOString();
            const replacements = new Map();
            for (const id of selectedIds) {
                const row = find.get(id);
                if (!row)
                    continue;
                const existing = rowToRecord(row);
                replacements.set(id, { ...existing, deletedAt: now, updatedAt: now });
            }
            if (replacements.size === 0)
                return 0;
            await this.rewriteRecords(replacements);
            indexRecords(db, [...replacements.values()]);
            await updateIndexMetadata(db, this.config.memoryFile, currentInvalidRecordCount(db));
            return replacements.size;
        });
    }
    async get(id, options = {}) {
        const db = await this.database();
        const row = db.prepare(`SELECT * FROM records WHERE id = ?${options.includeDeleted ? "" : " AND deleted_at IS NULL"}`).get(id);
        return row ? rowToRecord(row) : undefined;
    }
    async searchByIds(input) {
        const ids = [...new Set(input.ids.map((id) => id.trim()).filter(Boolean))].slice(0, 50);
        if (ids.length === 0)
            return [];
        const db = await this.database();
        const now = new Date().toISOString();
        const tagFilter = normalizeTags(input.tags ?? []);
        const queryTerms = tokenizeSearchText(input.query);
        const find = db.prepare("SELECT * FROM records WHERE id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)");
        const results = [];
        for (const id of ids) {
            const row = find.get(id, now);
            if (!row)
                continue;
            const record = rowToRecord(row);
            if (input.kind && record.kind !== input.kind)
                continue;
            if (tagFilter.some((tag) => !record.tags.includes(tag)))
                continue;
            results.push(scoreRecord(record, queryTerms));
        }
        return results;
    }
    async update(id, patch) {
        await this.ensureReady();
        return this.withWriteLock(async () => {
            const db = await this.database();
            const row = db.prepare("SELECT * FROM records WHERE id = ? AND deleted_at IS NULL").get(id);
            if (!row)
                return undefined;
            const existing = rowToRecord(row);
            const text = patch.text === undefined ? existing.text : patch.text.trim();
            if (!text)
                throw new Error("text is required");
            const previous = {
                text: existing.text,
                tags: existing.tags,
                source: existing.source,
                updatedAt: existing.updatedAt,
            };
            const updated = {
                ...existing,
                text,
                tags: patch.tags === undefined ? existing.tags : normalizeTags(patch.tags),
                source: patch.source?.trim() || existing.source,
                updatedAt: new Date().toISOString(),
                history: [...(existing.history ?? []), previous].slice(-50),
            };
            if (patch.expiresAt === null)
                delete updated.expiresAt;
            else if (patch.expiresAt !== undefined)
                updated.expiresAt = patch.expiresAt;
            await this.rewriteRecords(new Map([[id, updated]]));
            indexRecords(db, [updated]);
            await updateIndexMetadata(db, this.config.memoryFile, currentInvalidRecordCount(db));
            return updated;
        });
    }
    async updateActivities(updates) {
        if (updates.size === 0)
            return 0;
        await this.ensureReady();
        return this.withWriteLock(async () => {
            const db = await this.database();
            const find = db.prepare("SELECT * FROM records WHERE id = ? AND deleted_at IS NULL");
            const replacements = new Map();
            const now = new Date().toISOString();
            for (const [id, activity] of updates) {
                const row = find.get(id);
                if (!row)
                    continue;
                const existing = rowToRecord(row);
                if (!existing.activity)
                    continue;
                replacements.set(id, { ...existing, activity, updatedAt: now });
            }
            if (replacements.size === 0)
                return 0;
            await this.rewriteRecords(replacements);
            indexRecords(db, [...replacements.values()]);
            await updateIndexMetadata(db, this.config.memoryFile, currentInvalidRecordCount(db));
            return replacements.size;
        });
    }
    async supersede(id, input) {
        await this.ensureReady();
        return this.withWriteLock(async () => {
            const db = await this.database();
            const row = db.prepare("SELECT * FROM records WHERE id = ? AND deleted_at IS NULL").get(id);
            if (!row)
                return undefined;
            const existing = rowToRecord(row);
            const now = new Date().toISOString();
            const replacement = {
                id: input.id?.trim() || randomUUID(),
                kind: input.kind,
                text: input.text.trim(),
                tags: normalizeTags(input.tags ?? existing.tags),
                source: input.source?.trim() || existing.source,
                createdAt: input.createdAt ?? now,
                updatedAt: input.updatedAt ?? now,
                supersedes: id,
                ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
                ...(input.activity ? { activity: input.activity } : {}),
            };
            if (!replacement.text)
                throw new Error("text is required");
            const superseded = { ...existing, supersededBy: replacement.id, deletedAt: now, updatedAt: now };
            await this.rewriteRecords(new Map([[id, superseded]]), [replacement]);
            indexRecords(db, [superseded, replacement]);
            await updateIndexMetadata(db, this.config.memoryFile, currentInvalidRecordCount(db));
            return replacement;
        });
    }
    async diagnose() {
        const [records, health] = await Promise.all([this.all({ includeDeleted: true }), this.health()]);
        return diagnoseRecords(records, health.invalidRecordCount, health.indexFile);
    }
    async purge(options) {
        if (!hasPurgeSelector(options))
            throw new Error("Hard purge requires id, tags, namespace, source, or before");
        await this.ensureReady();
        return this.withWriteLock(async () => {
            const raw = await readFile(this.config.memoryFile, "utf8");
            const parsed = parseJsonl(raw);
            const matches = parsed.records.filter((record) => matchesPurge(record, options));
            const kept = parsed.records.filter((record) => !matchesPurge(record, options));
            if (options.dryRun !== false || matches.length === 0) {
                return maintenanceResult(parsed.records, parsed.invalidRecordCount, this.indexFile, matches.length, false);
            }
            const backupFile = await this.createBackup();
            await this.replaceCanonical(kept);
            const db = await this.database();
            replaceIndexRecords(db, kept);
            await updateIndexMetadata(db, this.config.memoryFile, 0);
            return maintenanceResult(kept, 0, this.indexFile, matches.length, true, backupFile);
        });
    }
    async compact(options = {}) {
        await this.ensureReady();
        return this.withWriteLock(async () => {
            const raw = await readFile(this.config.memoryFile, "utf8");
            const parsed = parseJsonl(raw);
            const compacted = compactRecords(parsed.records, {
                dedupe: options.dedupe !== false,
                dropDeleted: options.dropDeleted !== false,
                retentionDays: options.retentionDays ?? this.config.retentionDays,
            });
            const removed = parsed.records.length - compacted.length + parsed.invalidRecordCount;
            if (options.dryRun !== false || removed === 0) {
                return maintenanceResult(parsed.records, parsed.invalidRecordCount, this.indexFile, removed, false);
            }
            const backupFile = await this.createBackup();
            await this.replaceCanonical(compacted);
            const db = await this.database();
            replaceIndexRecords(db, compacted);
            await updateIndexMetadata(db, this.config.memoryFile, 0);
            return maintenanceResult(compacted, 0, this.indexFile, removed, true, backupFile);
        });
    }
    async backup(destination) {
        await this.ensureReady();
        return this.withWriteLock(() => this.createBackup(destination));
    }
    async exportTo(destination, options = {}) {
        const records = await this.all({ includeDeleted: options.includeDeleted, kind: options.kind });
        const requiredTags = normalizeTags([...(options.tags ?? []), ...(options.namespace ? [namespaceTag(options.namespace)] : [])]);
        const filtered = requiredTags.length === 0 ? records : records.filter((record) => requiredTags.every((tag) => record.tags.includes(tag)));
        const file = path.resolve(destination);
        await mkdir(path.dirname(file), { recursive: true });
        const body = filtered.length > 0 ? `${filtered.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
        const output = options.encrypted ? await encryptPortableExport(body, this.config.exportEncryptionKey ?? "") : body;
        await writeFile(file, output, "utf8");
        return { file, recordCount: filtered.length };
    }
    async search(input) {
        const queryTerms = tokenizeSearchText(input.query);
        const tagFilter = normalizeTags(input.tags ?? []);
        const limit = Math.max(1, Math.min(input.limit ?? this.config.maxSearchResults, 50));
        const db = await this.database();
        const { sql: filterSql, parameters: filterParameters } = recordFilters({ tagFilter, kind: input.kind });
        if (queryTerms.length === 0) {
            const rows = db
                .prepare(`SELECT records.* FROM records WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)${filterSql} ORDER BY created_at DESC LIMIT ?`)
                .all(new Date().toISOString(), ...filterParameters, limit);
            return rows.map((row) => ({ record: rowToRecord(row), score: 1, matchedTerms: [] }));
        }
        const match = queryTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
        const candidateLimit = Math.min(SEARCH_CANDIDATE_LIMIT, Math.max(100, limit * 10));
        const rows = db
            .prepare(`SELECT records.*, bm25(records_fts) AS fts_rank
         FROM records_fts
         JOIN records ON records.row_id = records_fts.rowid
         WHERE records_fts MATCH ? AND records.deleted_at IS NULL AND (records.expires_at IS NULL OR records.expires_at > ?)${filterSql}
         ORDER BY fts_rank ASC, records.priority DESC, records.created_at DESC
         LIMIT ?`)
            .all(match, new Date().toISOString(), ...filterParameters, candidateLimit);
        const lexicalPool = rows
            .map((row) => scoreRecord(rowToRecord(row), queryTerms))
            .filter((result) => result.matchedTerms.length > 0)
            .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt))
            .slice(0, this.config.rerankCommand ? Math.max(limit, this.config.hybridCandidateLimit) : limit);
        if (!this.config.rerankCommand)
            return lexicalPool;
        const broadRows = db
            .prepare(`SELECT records.* FROM records
         WHERE records.deleted_at IS NULL AND (records.expires_at IS NULL OR records.expires_at > ?)${filterSql}
         ORDER BY records.priority DESC, records.updated_at DESC
         LIMIT ?`)
            .all(new Date().toISOString(), ...filterParameters, this.config.hybridCandidateLimit);
        const candidates = new Map();
        for (const result of lexicalPool)
            candidates.set(result.record.id, result);
        for (const row of broadRows) {
            const record = rowToRecord(row);
            if (!candidates.has(record.id)) {
                candidates.set(record.id, { record, score: scorePriority(record), matchedTerms: [], retrieval: "hybrid" });
            }
        }
        try {
            return (await rerankWithCommand({
                command: this.config.rerankCommand,
                query: input.query,
                candidates: [...candidates.values()],
                timeoutMs: this.config.retrievalTimeoutMs,
            })).slice(0, limit);
        }
        catch {
            return lexicalPool.slice(0, limit);
        }
    }
    get indexFile() {
        return path.join(this.config.storeDir, INDEX_FILE);
    }
    async database() {
        await this.ensureReady();
        if (!this.syncPromise) {
            this.syncPromise = withDirectoryLock(this.config.storeDir, INDEX_LOCK_DIR, async () => {
                if (!this.db)
                    this.db = await openIndexDatabase(this.indexFile);
                await synchronizeIndex(this.db, this.config.memoryFile);
            }).finally(() => {
                this.syncPromise = undefined;
            });
        }
        await this.syncPromise;
        if (!this.db)
            throw new Error("Pathmark index did not initialize");
        return this.db;
    }
    async appendMany(records) {
        if (records.length === 0)
            return;
        await appendFile(this.config.memoryFile, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    }
    async rewriteRecord(id, replacement) {
        await this.rewriteRecords(new Map([[id, replacement]]));
    }
    async rewriteRecords(replacements, additions = []) {
        const raw = await readFile(this.config.memoryFile, "utf8");
        const lines = raw.split("\n").map((line) => {
            if (!line.trim())
                return line;
            const parsed = parseRecordLine(line);
            return parsed && replacements.has(parsed.id) ? JSON.stringify(replacements.get(parsed.id)) : line;
        });
        while (lines.length > 0 && !lines.at(-1)?.trim())
            lines.pop();
        lines.push(...additions.map((record) => JSON.stringify(record)), "");
        const tmp = path.join(this.config.storeDir, `.memory.${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 8)}.tmp`);
        await writeFile(tmp, lines.join("\n"), "utf8");
        await rename(tmp, this.config.memoryFile);
    }
    async replaceCanonical(records) {
        const tmp = path.join(this.config.storeDir, `.memory.${randomUUID()}.tmp`);
        const body = records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
        await writeFile(tmp, body, "utf8");
        await rename(tmp, this.config.memoryFile);
    }
    async createBackup(destination) {
        const file = destination
            ? path.resolve(destination)
            : path.join(this.config.storeDir, `memory.jsonl.backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
        await mkdir(path.dirname(file), { recursive: true });
        await copyFile(this.config.memoryFile, file);
        return file;
    }
    async withWriteLock(operation) {
        return withDirectoryLock(this.config.storeDir, WRITE_LOCK_DIR, operation);
    }
}
async function openIndexDatabase(indexFile) {
    await mkdir(path.dirname(indexFile), { recursive: true });
    let db;
    try {
        db = new (sqliteModule().DatabaseSync)(indexFile);
        initializeSchema(db);
        return db;
    }
    catch (error) {
        db?.close();
        if (!isCorruptSqliteError(error))
            throw error;
        const suffix = new Date().toISOString().replace(/[:.]/g, "-");
        await rename(indexFile, `${indexFile}.corrupt-${suffix}`).catch(() => undefined);
        await rm(`${indexFile}-wal`, { force: true }).catch(() => undefined);
        await rm(`${indexFile}-shm`, { force: true }).catch(() => undefined);
        try {
            const db = new (sqliteModule().DatabaseSync)(indexFile);
            initializeSchema(db);
            return db;
        }
        catch {
            throw error;
        }
    }
}
function initializeSchema(db) {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const version = getMeta(db, "schema_version");
    if (version && version !== INDEX_SCHEMA_VERSION) {
        db.exec("DROP TABLE IF EXISTS records_fts; DROP TABLE IF EXISTS record_tags; DROP TABLE IF EXISTS records; DELETE FROM meta;");
    }
    db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      expires_at TEXT,
      priority INTEGER NOT NULL,
      tags_key TEXT NOT NULL,
      search_tokens TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS records_created_at ON records(created_at DESC);
    CREATE INDEX IF NOT EXISTS records_kind_created_at ON records(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS records_content_hash ON records(content_hash, updated_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
      tokens,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
    setMeta(db, "schema_version", INDEX_SCHEMA_VERSION);
}
function isCorruptSqliteError(error) {
    const code = error.code;
    if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB")
        return true;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return message.includes("database disk image is malformed") || message.includes("file is not a database");
}
async function synchronizeIndex(db, memoryFile) {
    const before = await stat(memoryFile);
    if (metadataMatches(db, before))
        return;
    db.exec("BEGIN IMMEDIATE");
    try {
        const fresh = await stat(memoryFile);
        if (metadataMatches(db, fresh)) {
            db.exec("COMMIT");
            return;
        }
        const raw = await readFile(memoryFile, "utf8");
        const { records, invalidRecordCount } = parseJsonl(raw);
        db.exec("DELETE FROM records_fts; DELETE FROM records;");
        indexRecords(db, records, { transaction: false, fresh: true });
        const after = await stat(memoryFile);
        const rawBytes = Buffer.byteLength(raw);
        if (after.dev === fresh.dev && after.ino === fresh.ino && after.size === rawBytes) {
            writeMetadata(db, after, invalidRecordCount);
        }
        else {
            setMeta(db, "source_identity", "stale");
            setMeta(db, "source_bytes", String(rawBytes));
            setMeta(db, "source_mtime_ms", "-1");
            setMeta(db, "invalid_record_count", String(invalidRecordCount));
        }
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
function indexRecords(db, records, options = {}) {
    if (records.length === 0)
        return;
    const useTransaction = options.transaction !== false;
    if (useTransaction)
        db.exec("BEGIN IMMEDIATE");
    try {
        const insert = db.prepare(`
      INSERT INTO records (id, kind, text, tags_json, source, created_at, updated_at, deleted_at, expires_at, priority, tags_key, search_tokens, content_hash, record_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const upsert = db.prepare(`
      INSERT INTO records (id, kind, text, tags_json, source, created_at, updated_at, deleted_at, expires_at, priority, tags_key, search_tokens, content_hash, record_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        text = excluded.text,
        tags_json = excluded.tags_json,
        source = excluded.source,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        expires_at = excluded.expires_at,
        priority = excluded.priority,
        tags_key = excluded.tags_key,
        search_tokens = excluded.search_tokens,
        content_hash = excluded.content_hash,
        record_json = excluded.record_json
      RETURNING row_id
    `);
        const clearFts = db.prepare("DELETE FROM records_fts WHERE rowid = ?");
        const insertFts = db.prepare("INSERT INTO records_fts(rowid, tokens) VALUES (?, ?)");
        for (const record of records) {
            const searchTokens = tokenizeSearchText(`${record.text}\n${record.tags.join(" ")}\n${record.source}`).join(" ");
            const values = [
                record.id,
                record.kind,
                record.text,
                JSON.stringify(record.tags),
                record.source,
                record.createdAt,
                record.updatedAt,
                record.deletedAt ?? null,
                record.expiresAt ?? null,
                scorePriority(record),
                tagsKey(record.tags),
                searchTokens,
                contentHash(record),
                JSON.stringify(record),
            ];
            let rowId;
            if (options.fresh) {
                rowId = Number(insert.run(...values).lastInsertRowid);
            }
            else {
                rowId = upsert.get(...values).row_id;
                clearFts.run(rowId);
            }
            insertFts.run(rowId, searchTokens);
        }
        if (useTransaction)
            db.exec("COMMIT");
    }
    catch (error) {
        if (useTransaction)
            db.exec("ROLLBACK");
        throw error;
    }
}
function replaceIndexRecords(db, records) {
    db.exec("BEGIN IMMEDIATE");
    try {
        db.exec("DELETE FROM records_fts; DELETE FROM records;");
        indexRecords(db, records, { transaction: false, fresh: true });
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
function diagnoseRecords(records, invalidRecordCount, indexFile) {
    const now = Date.now();
    const active = records.filter((record) => !record.deletedAt && (!record.expiresAt || Date.parse(record.expiresAt) > now));
    const fingerprints = new Set();
    let duplicateCount = 0;
    for (const record of active) {
        const fingerprint = contentHash(record);
        if (fingerprints.has(fingerprint))
            duplicateCount += 1;
        else
            fingerprints.add(fingerprint);
    }
    return {
        totalRecords: records.length,
        activeRecords: active.length,
        deletedRecords: records.filter((record) => Boolean(record.deletedAt)).length,
        expiredRecords: records.filter((record) => Boolean(record.expiresAt && Date.parse(record.expiresAt) <= now)).length,
        exactDuplicateRecords: duplicateCount,
        conclusions: active.filter((record) => record.kind === "conclusion").length,
        invalidRecordCount,
        indexFile,
    };
}
function maintenanceResult(records, invalidRecordCount, indexFile, removedRecords, applied, backupFile) {
    return {
        ...diagnoseRecords(records, invalidRecordCount, indexFile),
        applied,
        removedRecords,
        ...(backupFile ? { backupFile } : {}),
    };
}
function compactRecords(records, options) {
    const now = Date.now();
    const retentionCutoff = options.retentionDays > 0 ? now - options.retentionDays * 24 * 60 * 60 * 1000 : undefined;
    let candidates = records.filter((record) => {
        if (options.dropDeleted && record.deletedAt)
            return false;
        if (record.expiresAt && Date.parse(record.expiresAt) <= now)
            return false;
        if (retentionCutoff && record.kind !== "conclusion" && Date.parse(record.updatedAt) < retentionCutoff)
            return false;
        return true;
    });
    if (!options.dedupe)
        return candidates;
    const counts = new Map();
    for (const record of candidates)
        counts.set(contentHash(record), (counts.get(contentHash(record)) ?? 0) + 1);
    const seen = new Set();
    candidates = [...candidates]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .filter((record) => {
        const hash = contentHash(record);
        if (seen.has(hash))
            return false;
        seen.add(hash);
        const occurrences = counts.get(hash) ?? 1;
        if (occurrences > 1)
            record.occurrences = Math.max(record.occurrences ?? 1, occurrences);
        return true;
    })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return candidates;
}
function hasPurgeSelector(options) {
    return Boolean(options.id || options.tags?.length || options.namespace || options.source || options.before);
}
function matchesPurge(record, options) {
    if (options.id && record.id !== options.id)
        return false;
    const requiredTags = normalizeTags([...(options.tags ?? []), ...(options.namespace ? [namespaceTag(options.namespace)] : [])]);
    if (requiredTags.some((tag) => !record.tags.includes(tag)))
        return false;
    if (options.source && record.source !== options.source)
        return false;
    if (options.before && record.updatedAt >= options.before)
        return false;
    return true;
}
export function namespaceTag(namespace) {
    const normalized = namespace.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!normalized)
        throw new Error("namespace is required");
    return `namespace:${normalized}`;
}
function recordFilters(input) {
    const clauses = [];
    const parameters = [];
    if (input.kind) {
        clauses.push("records.kind = ?");
        parameters.push(input.kind);
    }
    for (const tag of input.tagFilter) {
        clauses.push("instr(records.tags_key, ?) > 0");
        parameters.push(`\u001f${tag}\u001f`);
    }
    return { sql: clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "", parameters };
}
function parseJsonl(raw) {
    const records = [];
    let invalidRecordCount = 0;
    for (const line of raw.split("\n")) {
        if (!line.trim())
            continue;
        const record = parseRecordLine(line);
        if (record)
            records.push(record);
        else
            invalidRecordCount += 1;
    }
    return { records, invalidRecordCount };
}
function parseRecordLine(line) {
    try {
        const value = JSON.parse(line);
        if (!isRecord(value))
            return undefined;
        if (typeof value.id !== "string" || !value.id)
            return undefined;
        if (value.kind !== "memory" && value.kind !== "conclusion")
            return undefined;
        if (typeof value.text !== "string" || !value.text.trim())
            return undefined;
        if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string"))
            return undefined;
        if (typeof value.source !== "string")
            return undefined;
        if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string")
            return undefined;
        if (value.deletedAt !== undefined && typeof value.deletedAt !== "string")
            return undefined;
        if (value.expiresAt !== undefined && typeof value.expiresAt !== "string")
            return undefined;
        if (value.supersedes !== undefined && typeof value.supersedes !== "string")
            return undefined;
        if (value.supersededBy !== undefined && typeof value.supersededBy !== "string")
            return undefined;
        if (value.occurrences !== undefined && (!Number.isInteger(value.occurrences) || Number(value.occurrences) < 1))
            return undefined;
        if (value.history !== undefined && !isRecordHistory(value.history))
            return undefined;
        if (value.activity !== undefined && !isPathmarkActivity(value.activity))
            return undefined;
        return {
            id: value.id,
            kind: value.kind,
            text: value.text,
            tags: normalizeTags(value.tags),
            source: value.source,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
            ...(value.deletedAt ? { deletedAt: value.deletedAt } : {}),
            ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}),
            ...(value.supersedes ? { supersedes: value.supersedes } : {}),
            ...(value.supersededBy ? { supersededBy: value.supersededBy } : {}),
            ...(typeof value.occurrences === "number" ? { occurrences: value.occurrences } : {}),
            ...(Array.isArray(value.history) ? { history: value.history } : {}),
            ...(value.activity ? { activity: value.activity } : {}),
        };
    }
    catch {
        return undefined;
    }
}
function rowToRecord(row) {
    try {
        const parsed = parseRecordLine(row.record_json);
        if (parsed)
            return parsed;
    }
    catch {
        // Fall through to the legacy column representation.
    }
    const tags = JSON.parse(row.tags_json);
    return {
        id: row.id,
        kind: row.kind,
        text: row.text,
        tags: Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [],
        source: row.source,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
        ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    };
}
function isRecordHistory(value) {
    return (Array.isArray(value) &&
        value.every((entry) => isRecord(entry) &&
            typeof entry.text === "string" &&
            Array.isArray(entry.tags) &&
            entry.tags.every((tag) => typeof tag === "string") &&
            typeof entry.source === "string" &&
            typeof entry.updatedAt === "string"));
}
function isPathmarkActivity(value) {
    if (!isRecord(value))
        return false;
    if (value.type === "recall") {
        return (typeof value.queryHash === "string" &&
            Array.isArray(value.memoryIds) &&
            value.memoryIds.every((id) => typeof id === "string") &&
            Number.isInteger(value.memoryCount) &&
            Number(value.memoryCount) >= 0);
    }
    if (value.type !== "tool" || typeof value.toolName !== "string")
        return false;
    if (value.status !== "success" && value.status !== "error" && value.status !== "unknown")
        return false;
    if (value.filesChanged !== true && value.filesChanged !== false && value.filesChanged !== "unknown")
        return false;
    if (value.changedFiles !== undefined && (!Array.isArray(value.changedFiles) || !value.changedFiles.every((file) => typeof file === "string")))
        return false;
    for (const key of ["callId", "commandPreview", "commandHash", "inputPreview", "inputHash", "outputPreview", "outputHash"]) {
        if (value[key] !== undefined && typeof value[key] !== "string")
            return false;
    }
    for (const key of ["exitCode", "durationMs"]) {
        if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key])))
            return false;
    }
    return true;
}
function scoreRecord(record, queryTerms) {
    const haystackTerms = new Set(tokenizeSearchText(`${record.text}\n${record.tags.join(" ")}\n${record.source}`));
    const textTerms = new Set(tokenizeSearchText(record.text));
    const matchedTerms = queryTerms.filter((term) => haystackTerms.has(term));
    const exactTextMatches = matchedTerms.filter((term) => textTerms.has(term)).length;
    const tagMatches = matchedTerms.filter((term) => record.tags.includes(term)).length;
    return {
        record,
        score: matchedTerms.length + exactTextMatches * 2 + tagMatches * 3 + scorePriority(record),
        matchedTerms,
        retrieval: "lexical",
    };
}
function contentHash(record) {
    if (record.activity) {
        return createHash("sha256")
            .update(record.kind)
            .update("\0activity\0")
            .update(JSON.stringify(record.activity))
            .update("\0")
            .update(record.source)
            .update("\0")
            .update(record.id)
            .digest("hex");
    }
    const scopeTags = record.tags.filter((tag) => !tag.startsWith("session:") &&
        tag !== "immediate-prompt" &&
        tag !== "codex-raw" &&
        tag !== "codex-session" &&
        tag !== "redacted");
    return createHash("sha256")
        .update(record.kind)
        .update("\0")
        .update(normalizeContent(record.text))
        .update("\0")
        .update(scopeTags.sort().join("\0"))
        .digest("hex");
}
function normalizeContent(text) {
    return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
function scorePriority(record) {
    let priority = 0;
    if (record.kind === "conclusion")
        priority += 8;
    if (record.tags.includes("codex-summary"))
        priority += 6;
    if (record.tags.includes("project-note"))
        priority += 5;
    if (record.tags.includes("decision"))
        priority += 5;
    if (record.tags.includes("role-user"))
        priority += 3;
    if (record.tags.includes("role-assistant"))
        priority += 2;
    if (record.tags.includes("role-tool"))
        priority -= 4;
    if (record.tags.some((tag) => tag.endsWith("-import")))
        priority -= 1;
    return priority;
}
function metadataMatches(db, info) {
    return (getMeta(db, "source_identity") === fileIdentity(info) &&
        getMeta(db, "source_bytes") === String(info.size) &&
        getMeta(db, "source_mtime_ms") === String(info.mtimeMs));
}
async function updateIndexMetadata(db, memoryFile, invalidRecordCount) {
    writeMetadata(db, await stat(memoryFile), invalidRecordCount);
}
function writeMetadata(db, info, invalidRecordCount) {
    setMeta(db, "source_identity", fileIdentity(info));
    setMeta(db, "source_bytes", String(info.size));
    setMeta(db, "source_mtime_ms", String(info.mtimeMs));
    setMeta(db, "invalid_record_count", String(invalidRecordCount));
}
function fileIdentity(info) {
    return `${info.dev}:${info.ino}`;
}
function currentInvalidRecordCount(db) {
    const value = Number.parseInt(getMeta(db, "invalid_record_count") ?? "0", 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
}
function getMeta(db, key) {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row?.value;
}
function setMeta(db, key, value) {
    db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
let cachedSqlite;
function sqliteModule() {
    if (cachedSqlite)
        return cachedSqlite;
    const require = createRequire(import.meta.url);
    const originalEmitWarning = process.emitWarning;
    process.emitWarning = (() => undefined);
    try {
        cachedSqlite = require("node:sqlite");
    }
    finally {
        process.emitWarning = originalEmitWarning;
    }
    return cachedSqlite;
}
async function withDirectoryLock(storeDir, lockName, operation) {
    await mkdir(storeDir, { recursive: true });
    const lockDir = path.join(storeDir, lockName);
    const startedAt = Date.now();
    const lockTimeoutMs = lockName === INDEX_LOCK_DIR
        ? envMs("PATHMARK_INDEX_LOCK_TIMEOUT_MS", DEFAULT_INDEX_LOCK_TIMEOUT_MS)
        : envMs("PATHMARK_LOCK_TIMEOUT_MS", DEFAULT_LOCK_TIMEOUT_MS);
    const lockRetryMs = envMs("PATHMARK_LOCK_RETRY_MS", DEFAULT_LOCK_RETRY_MS);
    const staleLockMs = envMs("PATHMARK_STALE_LOCK_MS", DEFAULT_STALE_LOCK_MS);
    const noOwnerStaleLockMs = envMs("PATHMARK_NO_OWNER_STALE_LOCK_MS", DEFAULT_NO_OWNER_STALE_LOCK_MS);
    let lock;
    while (true) {
        try {
            await mkdir(lockDir);
            lock = await writeLockOwner(lockDir);
            break;
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
            if (await removeStaleLock(lockDir, { staleLockMs, noOwnerStaleLockMs }))
                continue;
            if (Date.now() - startedAt > lockTimeoutMs) {
                const label = lockName === WRITE_LOCK_DIR ? "store lock" : "index lock";
                throw new Error(`Timed out waiting for Pathmark ${label}: ${lockDir}`);
            }
            await sleep(lockRetryMs);
        }
    }
    try {
        return await operation();
    }
    finally {
        if (lock)
            await releaseLock(lock);
    }
}
async function writeLockOwner(lockDir) {
    const lock = { dir: lockDir, token: randomUUID() };
    try {
        await writeFile(path.join(lockDir, LOCK_OWNER_FILE), `${JSON.stringify({ pid: process.pid, token: lock.token, createdAtMs: Date.now() })}\n`, "utf8");
        return lock;
    }
    catch (error) {
        await rm(lockDir, { force: true, recursive: true });
        throw error;
    }
}
async function releaseLock(lock) {
    const owner = await readLockOwner(lock.dir);
    if (owner?.token === lock.token)
        await rm(lock.dir, { force: true, recursive: true });
}
async function removeStaleLock(lockDir, options) {
    if (options.staleLockMs <= 0 && options.noOwnerStaleLockMs <= 0)
        return false;
    try {
        const lock = await stat(lockDir);
        const ageMs = Date.now() - lock.mtimeMs;
        const owner = await readLockOwner(lockDir);
        if (!owner) {
            if (options.noOwnerStaleLockMs <= 0 || ageMs < options.noOwnerStaleLockMs)
                return false;
        }
        else if (owner.pid && isPidAlive(owner.pid)) {
            const ownerAgeMs = Date.now() - (owner.createdAtMs ?? lock.mtimeMs);
            if (options.staleLockMs <= 0 || ownerAgeMs < options.staleLockMs)
                return false;
        }
    }
    catch (error) {
        if (error.code === "ENOENT")
            return true;
        throw error;
    }
    try {
        await rm(lockDir, { force: false, recursive: true });
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return true;
        throw error;
    }
}
async function readLockOwner(lockDir) {
    try {
        const parsed = JSON.parse(await readFile(path.join(lockDir, LOCK_OWNER_FILE), "utf8"));
        return parsed && typeof parsed === "object" ? parsed : undefined;
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT" || error instanceof SyntaxError)
            return undefined;
        throw error;
    }
}
function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === "EPERM";
    }
}
function envMs(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function normalizeTags(tags) {
    return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}
function tagsKey(tags) {
    return `\u001f${tags.join("\u001f")}\u001f`;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=store.js.map