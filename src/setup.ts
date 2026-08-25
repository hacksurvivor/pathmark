import { loadConfig } from "./config.js";

type SetupTarget =
  | "codex"
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "opencode"
  | "gemini-cli"
  | "generic"
  | "openai-compatible"
  | "command";

interface SetupGuide {
  target: SetupTarget;
  title: string;
  summary: string;
  commands?: string[];
  config?: unknown;
  env?: Record<string, string>;
  notes: string[];
}

const TARGET_ALIASES: Record<string, SetupTarget> = {
  codex: "codex",
  "claude-code": "claude-code",
  claude: "claude-code",
  "claude-desktop": "claude-desktop",
  "claude_desktop": "claude-desktop",
  cursor: "cursor",
  opencode: "opencode",
  "open-code": "opencode",
  gemini: "gemini-cli",
  "gemini-cli": "gemini-cli",
  generic: "generic",
  mcp: "generic",
  "openai-compatible": "openai-compatible",
  openai: "openai-compatible",
  kimi: "openai-compatible",
  glm: "openai-compatible",
  zai: "openai-compatible",
  "z-ai": "openai-compatible",
  command: "command",
  cli: "command",
};

const TARGETS = [
  "codex",
  "claude-code",
  "claude-desktop",
  "cursor",
  "opencode",
  "gemini-cli",
  "generic",
  "openai-compatible",
  "command",
];

export async function runSetupCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const targetArg = args.find((arg) => !arg.startsWith("-"));

  if (!targetArg || targetArg === "list") {
    if (json) {
      console.log(JSON.stringify({ targets: TARGETS }, null, 2));
      return;
    }
    console.log(`Usage: pathmark setup <${TARGETS.join("|")}> [--json]`);
    console.log("");
    console.log("Targets:");
    for (const target of TARGETS) console.log(`  ${target}`);
    return;
  }

  const target = TARGET_ALIASES[targetArg.toLowerCase()];
  if (!target) {
    console.error(`Unknown setup target: ${targetArg}`);
    console.error(`Usage: pathmark setup <${TARGETS.join("|")}> [--json]`);
    process.exitCode = 2;
    return;
  }

  const guide = setupGuide(target);
  if (json) {
    console.log(JSON.stringify(guide, null, 2));
    return;
  }

  console.log(renderGuide(guide));
}

function setupGuide(target: SetupTarget): SetupGuide {
  const config = loadConfig();
  const env = {
    PATHMARK_STORE_DIR: config.storeDir,
    PATHMARK_SYNTHESIS_PROVIDER: "client",
  };

  if (target === "codex") {
    return {
      target,
      title: "Codex",
      summary: "Register Pathmark as a Codex MCP server and optionally enable Codex auto-capture hooks.",
      commands: ["codex mcp add pathmark -- pathmark", "pathmark codex install --replace-legacy-hooks"],
      env,
      notes: [
        "Use the install command when you want automatic Codex prompt/tool/transcript capture.",
        "Use the recall_memory MCP tool when you want a visible list of exactly which memories were used.",
        "The --replace-legacy-hooks flag removes old Pathmark-compatible hook commands without deleting memory files.",
      ],
    };
  }

  if (target === "claude-code") {
    return {
      target,
      title: "Claude Code",
      summary: "Register Pathmark as a local stdio MCP server in Claude Code.",
      commands: ["claude mcp add pathmark -- pathmark"],
      env,
      notes: [
        "Keep synthesis in client mode so Claude Code's own model answers from returned memory context.",
        "Ask Claude Code to call recall_memory at task start when you want a visible memory trace.",
        "Use the same PATHMARK_STORE_DIR as Codex to share memory across harnesses.",
      ],
    };
  }

  if (target === "opencode") {
    return {
      target,
      title: "opencode",
      summary: "Add Pathmark as a local MCP server in opencode config.",
      config: {
        mcp: {
          pathmark: {
            type: "local",
            command: ["pathmark"],
            enabled: true,
            environment: env,
          },
        },
      },
      notes: [
        "Merge this into your opencode config and keep the same store directory across harnesses.",
        "Call recall_memory before answering when you want the visible memory trace.",
      ],
    };
  }

  if (target === "gemini-cli") {
    return {
      target,
      title: "Gemini CLI",
      summary: "Add Pathmark to Gemini CLI's mcpServers settings.",
      config: {
        mcpServers: {
          pathmark: {
            command: "pathmark",
            args: [],
            env,
          },
        },
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  name: "pathmark-session-start",
                  type: "command",
                  command: "pathmark hook session-start",
                  timeout: 30_000,
                  description: "Inject the approved Pathmark intent snapshot at session start.",
                },
              ],
            },
          ],
          BeforeAgent: [
            {
              hooks: [
                {
                  name: "pathmark-before-agent",
                  type: "command",
                  command: "pathmark hook before-agent",
                  timeout: 20_000,
                  description: "Recall approved intent or bounded fresh scoped evidence, then capture the submitted prompt.",
                },
              ],
            },
          ],
          AfterTool: [
            {
              matcher: ".*",
              hooks: [
                {
                  name: "pathmark-after-tool",
                  type: "command",
                  command: "pathmark hook after-tool",
                  timeout: 10_000,
                  description: "Capture compact tool activity.",
                },
              ],
            },
          ],
          AfterAgent: [
            {
              hooks: [
                {
                  name: "pathmark-after-agent",
                  type: "command",
                  command: "pathmark hook after-agent",
                  timeout: 20_000,
                  description: "Capture the final assistant response.",
                },
              ],
            },
          ],
        },
      },
      notes: [
        "Place this in the Gemini CLI settings file that defines MCP servers.",
        "The generated hook entries enable automatic prompt, response, and compact tool capture.",
        "Call recall_memory before answering when you want the visible memory trace.",
      ],
    };
  }

  if (target === "claude-desktop" || target === "cursor" || target === "generic") {
    const title =
      target === "claude-desktop" ? "Claude Desktop" : target === "cursor" ? "Cursor" : "Generic MCP Client";
    return {
      target,
      title,
      summary: "Add Pathmark as a local stdio MCP server.",
      config: {
        mcpServers: {
          pathmark: {
            command: "pathmark",
            env,
          },
        },
      },
      notes: [
        "Use this shape for MCP clients that accept mcpServers JSON.",
        "Call recall_memory before answering when you want the visible memory trace.",
      ],
    };
  }

  if (target === "openai-compatible") {
    return {
      target,
      title: "Kimi, GLM/Z.ai, OpenRouter, LiteLLM, or local OpenAI-compatible gateway",
      summary: "Use Pathmark with an MCP host, and optionally let ask_memory synthesize through a compatible API.",
      env: {
        PATHMARK_STORE_DIR: config.storeDir,
        PATHMARK_SYNTHESIS_PROVIDER: "openai-compatible",
        PATHMARK_OPENAI_BASE_URL: "https://api.provider.example/v1",
        PATHMARK_OPENAI_API_KEY: "replace-me",
        PATHMARK_OPENAI_MODEL: "replace-me",
      },
      notes: [
        "Raw models still need an MCP-capable host to call Pathmark tools.",
        "Use recall_memory through that host when you want a visible memory trace.",
        "The OpenAI-compatible mode affects ask_memory synthesis only; save/search tools remain local.",
      ],
    };
  }

  return {
    target,
    title: "Command-backed synthesis",
    summary: "Use any local subscription CLI or model command for ask_memory synthesis.",
    env: {
      PATHMARK_STORE_DIR: config.storeDir,
      PATHMARK_SYNTHESIS_PROVIDER: "command",
      PATHMARK_CHAT_COMMAND: "your-agent-cli chat --model your-model",
    },
    notes: [
      "PATHMARK_CHAT_COMMAND receives the memory prompt on stdin and must write an answer to stdout.",
      "Use recall_memory through an MCP host when you want a visible memory trace.",
    ],
  };
}

function renderGuide(guide: SetupGuide): string {
  const lines = [`# ${guide.title}`, "", guide.summary, ""];
  if (guide.commands?.length) {
    lines.push("Commands:", "");
    lines.push(...guide.commands.map((command) => `  ${command}`));
    lines.push("");
  }
  if (guide.config) {
    lines.push("Config:", "");
    lines.push(JSON.stringify(guide.config, null, 2));
    lines.push("");
  }
  if (guide.env) {
    lines.push("Environment:", "");
    for (const [key, value] of Object.entries(guide.env)) lines.push(`  ${key}=${shellQuote(value)}`);
    lines.push("");
  }
  if (guide.notes.length) {
    lines.push("Notes:");
    for (const note of guide.notes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
