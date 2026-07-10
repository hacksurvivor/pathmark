import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const expectedTag = `v${packageJson.version}`;
const suppliedTag = process.argv.find((argument) => argument.startsWith("--tag="))?.slice("--tag=".length);
const actualTag = suppliedTag ?? process.env.GITHUB_REF_NAME;

if (!actualTag) throw new Error("Release verification requires GITHUB_REF_NAME or --tag=vX.Y.Z");
assert.equal(actualTag, expectedTag, `Release tag ${actualTag} does not match package version ${packageJson.version}`);

const mcpSource = await readFile("src/mcp.ts", "utf8");
assert.equal(
  mcpSource.includes(`version: ${JSON.stringify(packageJson.version)}`),
  true,
  "MCP server version must match package.json",
);

const releaseNotes = path.join("docs", "releases", `${expectedTag}.md`);
const notes = await readFile(releaseNotes, "utf8");
assert.equal(notes.includes(`# Pathmark ${expectedTag}`), true, `Release notes must start with # Pathmark ${expectedTag}`);

console.log(`Release metadata verified for ${expectedTag}`);
