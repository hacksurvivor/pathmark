import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { codexConfigPath, pathmarkStoreDir } from "./paths.js";

const PATHMARK_BLOCK_START = "# >>> pathmark MCP >>>";
const PATHMARK_BLOCK_END = "# <<< pathmark MCP <<<";
const PATHMARK_BLOCK_RE = /(?:^|\n)# >>> pathmark MCP >>>\n[\s\S]*?\n# <<< pathmark MCP <<<(?:\n|$)/g;
const PATHMARK_MCP_TABLE_RE = /^\s*\[\s*mcp_servers\s*\.\s*pathmark(?:\s*\.\s*env)?\s*\]\s*(?:#.*)?$/;

export interface PathmarkMcpStatus {
  installed: boolean;
  hooksFeatureEnabled: boolean;
}

export async function installPathmarkMcp(configPath = codexConfigPath()): Promise<void> {
  const current = await readText(configPath);
  await backupConfigFile(configPath);
  const enabled = enableHooksFeature(current);
  if (hasUnmanagedPathmarkTable(enabled)) {
    await writeText(configPath, enabled);
    return;
  }
  const block = [
    PATHMARK_BLOCK_START,
    "[mcp_servers.pathmark]",
    'command = "pathmark"',
    `env = { PATHMARK_STORE_DIR = ${tomlString(pathmarkStoreDir())}, PATHMARK_SYNTHESIS_PROVIDER = "client" }`,
    PATHMARK_BLOCK_END,
  ].join("\n");
  const base = stripPathmarkBlock(enabled).trimEnd();
  await writeText(configPath, `${base ? `${base}\n\n` : ""}${block}\n`);
}

export async function removePathmarkMcp(configPath = codexConfigPath()): Promise<void> {
  await backupConfigFile(configPath);
  const next = stripPathmarkBlock(await readText(configPath)).trimEnd();
  await writeText(configPath, next ? `${next}\n` : "");
}

export async function hasPathmarkMcp(configPath = codexConfigPath()): Promise<boolean> {
  const content = await readText(configPath);
  return pathmarkMcpStatusFromContent(content).installed;
}

export async function pathmarkMcpStatus(configPath = codexConfigPath()): Promise<PathmarkMcpStatus> {
  return pathmarkMcpStatusFromContent(await readText(configPath));
}

export function enableHooksFeature(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trimEnd();
  if (!normalized) return "[features]\nhooks = true\n";

  const lines = normalized.split("\n");
  const header = lines.findIndex((line) => /^\s*\[features\]\s*$/.test(line));
  if (header === -1) return `${normalized}\n\n[features]\nhooks = true\n`;

  let end = lines.length;
  let hooksLine = -1;
  for (let index = header + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[index])) {
      end = index;
      break;
    }
    if (/^\s*hooks\s*=/.test(lines[index])) hooksLine = index;
  }

  if (hooksLine >= 0) lines[hooksLine] = "hooks = true";
  else lines.splice(end, 0, "hooks = true");
  return `${lines.join("\n")}\n`;
}

function pathmarkMcpStatusFromContent(content: string): PathmarkMcpStatus {
  return {
    installed:
      (content.includes(PATHMARK_BLOCK_START) && content.includes(PATHMARK_BLOCK_END)) ||
      hasUnmanagedPathmarkTable(content),
    hooksFeatureEnabled: /^\s*hooks\s*=\s*true\s*$/m.test(featuresTable(content)),
  };
}

function stripPathmarkBlock(content: string): string {
  return content.replace(PATHMARK_BLOCK_RE, "\n").replace(/\n{3,}/g, "\n\n");
}

function hasUnmanagedPathmarkTable(content: string): boolean {
  const unmanaged = stripPathmarkBlock(content);
  return unmanaged
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => PATHMARK_MCP_TABLE_RE.test(line));
}

function featuresTable(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/(?:^|\n)\s*\[features\]\s*\n([\s\S]*?)(?=\n\s*\[[^\]]+\]\s*(?:\n|$)|$)/);
  return match?.[1] ?? "";
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

async function backupConfigFile(file: string): Promise<void> {
  try {
    await copyFile(file, `${file}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
