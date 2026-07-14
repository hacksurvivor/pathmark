#!/usr/bin/env node
import { runMcpServer } from "./mcp.js";
const [domain, ...rest] = process.argv.slice(2);
if (domain === "codex") {
    const { runCodexCommand } = await import("./codex/cli.js");
    await runCodexCommand(rest);
}
else if (domain === "setup") {
    const { runSetupCommand } = await import("./setup.js");
    await runSetupCommand(rest);
}
else if (["doctor", "compact", "backup", "export", "import", "ingest", "purge"].includes(domain ?? "")) {
    const { runManagementCommand } = await import("./manage.js");
    await runManagementCommand(domain, rest);
}
else if (domain === "hook") {
    const { runPortableHook } = await import("./hook-cli.js");
    await runPortableHook(rest[0]);
}
else if (domain === "help" || domain === "--help" || domain === "-h") {
    console.log("Usage: pathmark [setup <client>|codex <command>|hook <event>|doctor|compact|backup|export|import|ingest|purge]");
    console.log("");
    console.log("No arguments starts the Pathmark MCP stdio server.");
}
else {
    if (domain) {
        console.error(`Unknown command: ${domain}`);
        console.error("Usage: pathmark [setup <client>|codex <command>|hook <event>|doctor|compact|backup|export|import|ingest|purge]");
        process.exitCode = 2;
    }
    else {
        await runMcpServer();
    }
}
//# sourceMappingURL=index.js.map