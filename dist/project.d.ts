export declare function workspaceTag(cwd: string): string;
export declare function projectScope(cwd: string): {
    id: string;
    root: string;
    tags: string[];
};
export declare function initializeProject(cwd: string, id?: string): ReturnType<typeof projectScope>;
