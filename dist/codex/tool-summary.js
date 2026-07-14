import { redactSecrets } from "../redact.js";
const SHELL_TOOLS = new Set(["Bash", "shell", "local_shell", "exec", "functions.exec_command"]);
const SKIP_TOOL_PREFIXES = ["mcp__pathmark", "pathmark"];
const TRIVIAL_COMMANDS = [
    "cd",
    "true",
    "false",
    "echo",
    "printf",
    "pwd",
    "ls",
    "cat",
    "head",
    "tail",
    "sed",
    "rg",
    "grep",
    "jq",
    "awk",
    "find",
    "wc",
    "du",
    "git status",
    "git log",
    "git diff",
    "git show",
    "git branch",
    "git remote",
    "git ls-files",
    "git grep",
    "git rev-parse",
];
export function summarizeToolUse(input) {
    const name = input.tool_name?.trim() ?? "";
    if (!name)
        return "";
    if (SKIP_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix)))
        return "";
    if (SHELL_TOOLS.has(name)) {
        const command = shellCommand(input.tool_input).trim();
        if (!command)
            return "";
        const summaryCommand = nonPathmarkShellCommand(command);
        if (!summaryCommand)
            return "";
        if (isTrivialShellCommand(summaryCommand))
            return "";
        const redacted = redactSecrets(summaryCommand);
        return `ran: ${redacted.text.slice(0, 200)}`;
    }
    if (name === "apply_patch" || name === "functions.apply_patch") {
        const patch = patchText(input.tool_input);
        const files = changedFiles(patch);
        return files.length > 0 ? `edited: ${files.slice(0, 8).join(", ")}` : "applied a patch";
    }
    return `used ${name}`;
}
function shellCommand(input) {
    if (Array.isArray(input))
        return input.map(String).join(" ");
    if (!isRecord(input))
        return "";
    if (typeof input.cmd === "string")
        return input.cmd;
    if (Array.isArray(input.cmd))
        return input.cmd.map(String).join(" ");
    if (typeof input.command === "string")
        return input.command;
    if (Array.isArray(input.command))
        return input.command.map(String).join(" ");
    return "";
}
function patchText(input) {
    if (typeof input === "string")
        return input;
    if (!isRecord(input))
        return "";
    if (typeof input.input === "string")
        return input.input;
    if (typeof input.patch === "string")
        return input.patch;
    return "";
}
function changedFiles(patch) {
    const files = [
        ...[...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1]),
        ...[...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]),
    ];
    return [...new Set(files.map((file) => file.trim()).filter((file) => file && file !== "/dev/null"))];
}
function isPathmarkShellCommand(command) {
    return shellSegments(command).some(isPathmarkShellSegment);
}
function nonPathmarkShellCommand(command) {
    const segments = shellSegments(command);
    if (segments.length === 0)
        return command;
    const nonPathmarkSegments = segments.filter((segment) => !isPathmarkShellSegment(segment));
    if (nonPathmarkSegments.length === 0)
        return "";
    if (nonPathmarkSegments.length === segments.length)
        return command;
    return nonPathmarkSegments.join(" && ");
}
function shellSegments(command) {
    return command
        .split(/\s*(?:&&|\|\||;|\|)\s*/)
        .map(stripLeadingEnvAssignments)
        .filter(Boolean);
}
function isPathmarkShellSegment(segment) {
    return (/^pathmark(?:\s|$)/.test(segment) ||
        /^npx(?:\s+(?:--yes|-y))*\s+pathmark(?:\s|$)/.test(segment) ||
        isPathmarkNodeSegment(segment));
}
function isPathmarkNodeSegment(segment) {
    const tokens = segment.trim().split(/\s+/);
    if (tokens[0] !== "node")
        return false;
    const script = tokens.slice(1).find((token) => !token.startsWith("-")) ?? "";
    if (script.includes("pathmark"))
        return true;
    const distIndex = tokens.findIndex((token, index) => index > 0 && /(?:^|\/)dist\/index\.js$/.test(token));
    return distIndex > 0 && tokens[distIndex + 1] === "codex";
}
function stripLeadingEnvAssignments(command) {
    let text = command.trim();
    if (text.startsWith("env "))
        text = text.slice(4).trimStart();
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) {
        text = text.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s*/, "").trimStart();
    }
    return text;
}
function isTrivialShellCommand(command) {
    if (hasMutationShellMarker(command))
        return false;
    if (hasUsefulShellChain(command))
        return false;
    return isTrivialReadCommand(command);
}
function isTrivialReadCommand(command) {
    const normalized = stripLeadingEnvAssignments(command);
    return TRIVIAL_COMMANDS.some((trivial) => {
        if (normalized === trivial)
            return true;
        if (!normalized.startsWith(`${trivial} `))
            return false;
        if (trivial === "sed" && /\s-i(?:\S*)?(?:\s|$)/.test(normalized))
            return false;
        if (trivial === "find" && /\s(?:-delete|-exec)(?:\s|$)/.test(normalized))
            return false;
        return true;
    });
}
function hasUsefulShellChain(command) {
    if (!/(?:&&|\|\||;)/.test(command))
        return false;
    const segments = command
        .split(/\s*(?:&&|\|\||;)\s*/)
        .map(stripLeadingEnvAssignments)
        .filter(Boolean);
    if (segments.length < 2)
        return false;
    return segments.some((segment) => !isPathmarkShellCommand(segment) && !isTrivialReadCommand(segment));
}
function hasMutationShellMarker(command) {
    return (/\|\s*xargs\b/.test(command) ||
        /\|\s*tee\b/.test(command) ||
        /\|\s*(?:bash|sh|zsh|python|python3)\b/.test(command) ||
        /\|\s*git\s+apply\b/.test(command) ||
        /\|\s*sponge\b/.test(command) ||
        /\|\s*while\b[\s\S]*\b(?:rm|mv|cp|sed|perl|python|python3)\b/.test(command) ||
        hasChainedMutatingCommand(command) ||
        hasNonNullOutputRedirection(command) ||
        command.includes("<<") ||
        /\bsed\b[^|;&]*\s-i(?:\S*)?(?:\s|$)/.test(command) ||
        /\bfind\b[\s\S]*(?:\s-delete\b|\s-exec\b)/.test(command));
}
function hasChainedMutatingCommand(command) {
    return command
        .split(/\s*(?:&&|\|\||;)\s*/)
        .map(stripLeadingEnvAssignments)
        .some(isMutatingShellSegment);
}
function isMutatingShellSegment(segment) {
    const command = segment.trim().replace(/^sudo\s+/, "");
    return (/^git\s+(?:add|commit)\b/.test(command) ||
        /^(?:rm|mv|cp|chmod|chown|mkdir|touch)\b/.test(command) ||
        /^perl\b[\s\S]*\s-i(?:\S*)?(?:\s|$)/.test(command));
}
function hasNonNullOutputRedirection(command) {
    let quote;
    for (let index = 0; index < command.length; index += 1) {
        const char = command[index];
        if (char === "\\" && quote) {
            index += 1;
            continue;
        }
        if (quote) {
            if (char === quote)
                quote = undefined;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (char !== ">")
            continue;
        const previous = command[index - 1] ?? "";
        const next = command[index + 1] ?? "";
        if (previous === "<" || previous === ">" || previous === "=" || next === "=")
            continue;
        let targetStart = next === ">" ? index + 2 : index + 1;
        while (/\s/.test(command[targetStart] ?? ""))
            targetStart += 1;
        if ((command[targetStart] ?? "") === "&")
            continue;
        let targetEnd = targetStart;
        while (targetEnd < command.length && !/[\s;&|]/.test(command[targetEnd]))
            targetEnd += 1;
        const target = command.slice(targetStart, targetEnd);
        if (target && target !== "/dev/null")
            return true;
    }
    return false;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=tool-summary.js.map