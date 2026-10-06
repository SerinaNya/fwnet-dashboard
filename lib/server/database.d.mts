export const DEFAULT_DATABASE_PATH: string
export function resolveDatabasePath(databasePath?: string): string
export function toEpochMilliseconds(value: unknown, label?: string): number
export function migrateDatabaseFile(databasePath?: string): number
