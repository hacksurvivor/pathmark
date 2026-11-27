export declare const ALIAS_FILE = "project-aliases.json";
export declare function projectAliases(storeDir?: string): Record<string, string>;
export declare function canonicalProject(name: string, storeDir?: string): string;
