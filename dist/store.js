import { createHash, randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { tokenizeSearchText } from "./tokenize.js";
const DEFAULT_LOCK_RETRY_MS = 10;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;
const DEFAULT_NO_OWNER_STALE_LOCK_MS = 5000;
const LOCK_OWNER_FILE = "owner.json";
const INDEX_FILE = "memory.index.sqlite";
const INDEX_SCHEMA_VERSION = "2";
const SEARCH_CANDIDATE_LIMIT = 2000;
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
    async add(input) {
        const { record } = await this.addRecord(input);
        return record;
    }
    async addRecord(input) {
        const [result] = await this.addRecords([input]);
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
            const results = [];
            const createdRecords = [];
            const pending = new Map();
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
                };
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
        if (!options.includeDeleted)
            clauses.push("deleted_at IS NULL");
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
            .prepare(`SELECT records.* FROM records WHERE deleted_at IS NULL${filterSql} ORDER BY created_at DESC LIMIT ?`)
            .all(...parameters, limit);
        return rows.map(rowToRecord);
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
    async search(input) {
        const queryTerms = tokenizeSearchText(input.query);
        const tagFilter = normalizeTags(input.tags ?? []);
        const limit = Math.max(1, Math.min(input.limit ?? this.config.maxSearchResults, 50));
        const db = await this.database();
        const { sql: filterSql, parameters: filterParameters } = recordFilters({ tagFilter, kind: input.kind });
        if (queryTerms.length === 0) {
            const rows = db
                .prepare(`SELECT records.* FROM records WHERE deleted_at IS NULL${filterSql} ORDER BY created_at DESC LIMIT ?`)
                .all(...filterParameters, limit);
            return rows.map((row) => ({ record: rowToRecord(row), score: 1, matchedTerms: [] }));
        }
        const match = queryTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
        const candidateLimit = Math.min(SEARCH_CANDIDATE_LIMIT, Math.max(100, limit * 10));
        const rows = db
            .prepare(`SELECT records.*, bm25(records_fts) AS fts_rank
         FROM records_fts
         JOIN records ON records.row_id = records_fts.rowid
         WHERE records_fts MATCH ? AND records.deleted_at IS NULL${filterSql}
         ORDER BY fts_rank ASC, records.priority DESC, records.created_at DESC
         LIMIT ?`)
            .all(match, ...filterParameters, candidateLimit);
        return rows
            .map((row) => scoreRecord(rowToRecord(row), queryTerms))
            .filter((result) => result.matchedTerms.length > 0)
            .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt))
            .slice(0, limit);
    }
    get indexFile() {
        return path.join(this.config.storeDir, INDEX_FILE);
    }
    async database() {
        await this.ensureReady();
        if (!this.db)
            this.db = await openIndexDatabase(this.indexFile);
        if (!this.syncPromise) {
            this.syncPromise = synchronizeIndex(this.db, this.config.memoryFile).finally(() => {
                this.syncPromise = undefined;
            });
        }
        await this.syncPromise;
        return this.db;
    }
    async appendMany(records) {
        if (records.length === 0)
            return;
        await appendFile(this.config.memoryFile, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    }
    async rewriteRecord(id, replacement) {
        const raw = await readFile(this.config.memoryFile, "utf8");
        const lines = raw.split("\n").map((line) => {
            if (!line.trim())
                return line;
            const parsed = parseRecordLine(line);
            return parsed?.id === id ? JSON.stringify(replacement) : line;
        });
        const tmp = path.join(this.config.storeDir, `.memory.${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 8)}.tmp`);
        await writeFile(tmp, lines.join("\n"), "utf8");
        await rename(tmp, this.config.memoryFile);
    }
    async withWriteLock(operation) {
        await mkdir(this.config.storeDir, { recursive: true });
        const lockDir = path.join(this.config.storeDir, ".memory.lock");
        const startedAt = Date.now();
        const lockTimeoutMs = envMs("PATHMARK_LOCK_TIMEOUT_MS", DEFAULT_LOCK_TIMEOUT_MS);
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
                if (Date.now() - startedAt > lockTimeoutMs)
                    throw new Error(`Timed out waiting for Pathmark store lock: ${lockDir}`);
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
}
async function openIndexDatabase(indexFile) {
    await mkdir(path.dirname(indexFile), { recursive: true });
    try {
        const db = new (sqliteModule().DatabaseSync)(indexFile);
        initializeSchema(db);
        return db;
    }
    catch (error) {
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
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
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
      priority INTEGER NOT NULL,
      tags_key TEXT NOT NULL,
      search_tokens TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS records_created_at ON records(created_at DESC);
    CREATE INDEX IF NOT EXISTS records_kind_created_at ON records(kind, created_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
      tokens,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
    setMeta(db, "schema_version", INDEX_SCHEMA_VERSION);
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
      INSERT INTO records (id, kind, text, tags_json, source, created_at, updated_at, deleted_at, priority, tags_key, search_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const upsert = db.prepare(`
      INSERT INTO records (id, kind, text, tags_json, source, created_at, updated_at, deleted_at, priority, tags_key, search_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        text = excluded.text,
        tags_json = excluded.tags_json,
        source = excluded.source,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        priority = excluded.priority,
        tags_key = excluded.tags_key,
        search_tokens = excluded.search_tokens
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
                scorePriority(record),
                tagsKey(record.tags),
                searchTokens,
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
        return {
            id: value.id,
            kind: value.kind,
            text: value.text,
            tags: normalizeTags(value.tags),
            source: value.source,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
            ...(value.deletedAt ? { deletedAt: value.deletedAt } : {}),
        };
    }
    catch {
        return undefined;
    }
}
function rowToRecord(row) {
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
    };
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
    };
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