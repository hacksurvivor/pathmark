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

const citation = await readFile("CITATION.cff", "utf8");
assert.equal(
  citation.includes(`version: ${JSON.stringify(packageJson.version)}`),
  true,
  "CITATION.cff version must match package.json",
);

const codeMeta = JSON.parse(await readFile("codemeta.json", "utf8"));
assert.equal(codeMeta.version, packageJson.version, "codemeta.json version must match package.json");

const serverJson = JSON.parse(await readFile("server.json", "utf8"));
assert.equal(
  serverJson.$schema,
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "server.json must use the current MCP Registry schema",
);
assert.equal(packageJson.mcpName, serverJson.name, "package.json mcpName must match server.json name");
assert.equal(typeof serverJson.description, "string", "server.json description must be a string");
assert.equal(serverJson.description.length > 0, true, "server.json description must not be empty");
assert.equal(serverJson.description.length <= 100, true, "server.json description must be at most 100 characters");
assert.equal(serverJson.version, packageJson.version, "server.json version must match package.json");
assert.equal(serverJson.packages?.length, 1, "server.json must contain exactly one package");
assert.equal(serverJson.packages[0].registryType, "npm", "server.json package must use the npm registry");
assert.equal(serverJson.packages[0].identifier, packageJson.name, "server.json package name must match package.json");
assert.equal(serverJson.packages[0].version, packageJson.version, "server.json package version must match package.json");
assert.equal(serverJson.packages[0].transport?.type, "stdio", "server.json package must use stdio transport");
assert.equal(packageJson.files.includes("server.json"), true, "server.json must be included in the npm tarball");

const releaseNotes = path.join("docs", "releases", `${expectedTag}.md`);
const notes = await readFile(releaseNotes, "utf8");
assert.equal(notes.includes(`# Pathmark ${expectedTag}`), true, `Release notes must start with # Pathmark ${expectedTag}`);

console.log(`Release metadata verified for ${expectedTag}`);
