import type { PathmarkConfig } from "./types.js";
export interface WebMcpServerOptions {
    port?: number;
    tags?: string[];
    config?: PathmarkConfig;
}
export interface WebMcpServerHandle {
    url: string;
    close(): Promise<void>;
}
export declare function runWebMcpCommand(args: string[]): Promise<void>;
export declare function startWebMcpServer(options?: WebMcpServerOptions): Promise<WebMcpServerHandle>;
