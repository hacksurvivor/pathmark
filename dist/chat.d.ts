import type { PathmarkConfig, SearchResult } from "./types.js";
export declare function synthesizeWithCommand(input: {
    config: PathmarkConfig;
    question: string;
    context: SearchResult[];
}): Promise<string | undefined>;
export declare function parseClaudeJsonAnswer(stdout: string): string;
