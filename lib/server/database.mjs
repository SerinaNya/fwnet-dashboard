import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"

export const DEFAULT_DATABASE_PATH = "./data/fwnet.sqlite"
const CURRENT_SCHEMA_VERSION = 1
const migrationPath = fileURLToPath(new URL("./migrations/001-initial.sql", import.meta.url))

export function resolveDatabasePath(databasePath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH) {
  return databasePath === ":memory:" ? databasePath : path.resolve(databasePath)
}

export function migrateDatabase(database) {
  let version = Number(database.prepare("PRAGMA user_version").get().user_version)
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`数据库版本 ${version} 高于当前支持版本 ${CURRENT_SCHEMA_VERSION}。`)
  }

  if (version < 1) {
    const migration = readFileSync(migrationPath, "utf8")
    database.exec("BEGIN IMMEDIATE")
    try {
      database.exec(migration)
      database.exec("PRAGMA user_version = 1")
      database.exec("COMMIT")
      version = 1
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  }

  return version
}

export function openDatabase(databasePath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH) {
  const resolvedPath = resolveDatabasePath(databasePath)
  if (resolvedPath !== ":memory:") mkdirSync(path.dirname(resolvedPath), { recursive: true })

  const database = new DatabaseSync(resolvedPath)
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("PRAGMA busy_timeout = 5000")
    if (resolvedPath !== ":memory:") database.exec("PRAGMA journal_mode = WAL")
    migrateDatabase(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export function migrateDatabaseFile(databasePath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH) {
  const database = openDatabase(databasePath)
  try {
    return migrateDatabase(database)
  } finally {
    database.close()
  }
}
