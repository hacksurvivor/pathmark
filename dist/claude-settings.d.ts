export interface ApplyPermissionsResult {
    file: string;
    added: string[];
    alreadyPresent: string[];
    backupFile?: string;
}
export declare function claudeSettingsFile(): string;
export declare function applyClaudeCodePermissions(file?: string): Promise<ApplyPermissionsResult>;
