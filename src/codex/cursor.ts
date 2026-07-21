import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CaptureCursor {
  count: number;
  updatedAt: string;
  transcriptFingerprint?: string;
  parserVersion?: number;
}

export function cursorPath(storeDir: string, sessionId: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_") || "_";
  return path.join(storeDir, "codex-cursors", `${safeSession}.json`);
}

export async function readCursor(storeDir: string, sessionId: string): Promise<number> {
  return (await readCursorState(storeDir, sessionId)).count;
}

export async function readCursorState(storeDir: string, sessionId: string): Promise<CaptureCursor> {
  try {
    const parsed = JSON.parse(await readFile(cursorPath(storeDir, sessionId), "utf8")) as Partial<CaptureCursor>;
    return {
      count: typeof parsed.count === "number" && Number.isFinite(parsed.count) && parsed.count >= 0 ? parsed.count : 0,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      transcriptFingerprint:
        typeof parsed.transcriptFingerprint === "string" && parsed.transcriptFingerprint
          ? parsed.transcriptFingerprint
          : undefined,
      parserVersion:
        typeof parsed.parserVersion === "number" && Number.isInteger(parsed.parserVersion) && parsed.parserVersion > 0
          ? parsed.parserVersion
          : undefined,
    };
  } catch {
    return { count: 0, updatedAt: "" };
  }
}

export async function writeCursor(
  storeDir: string,
  sessionId: string,
  count: number,
  metadata: { transcriptFingerprint?: string; parserVersion?: number } = {},
): Promise<void> {
  const file = cursorPath(storeDir, sessionId);
  const safeCount = Number.isFinite(count) && count >= 0 ? count : 0;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      {
        count: safeCount,
        updatedAt: new Date().toISOString(),
        ...(metadata.transcriptFingerprint ? { transcriptFingerprint: metadata.transcriptFingerprint } : {}),
        ...(metadata.parserVersion ? { parserVersion: metadata.parserVersion } : {}),
      },
      null,
      2,
    ),
    "utf8",
  );
}
