import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"

export const DEFAULT_DATABASE_PATH = "./data/fwnet.sqlite"
const CURRENT_SCHEMA_VERSION = 2
const migrationPaths = [
  fileURLToPath(new URL("./migrations/001-initial.sql", import.meta.url)),
  fileURLToPath(new URL("./migrations/002-epoch-milliseconds.sql", import.meta.url)),
]
const MIN_EPOCH_MILLISECONDS = Date.parse("0001-01-01T00:00:00.000Z")
const MAX_EPOCH_MILLISECONDS = Date.parse("9999-12-31T23:59:59.999Z")

export function toEpochMilliseconds(value, label = "更新时间") {
  if (typeof value === "number") {
    if (
      Number.isSafeInteger(value) &&
      value >= MIN_EPOCH_MILLISECONDS &&
      value <= MAX_EPOCH_MILLISECONDS
    ) {
      return value
    }
    throw new Error(`${label}必须是有效范围内的整数毫秒时间戳。`)
  }

  if (typeof value !== "string") {
    throw new Error(`${label}必须是有效 ISO 日期或整数毫秒时间戳。`)
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new Error(`${label}必须是带时区且精确到毫秒的 ISO 日期。`)

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const millisecond = Number(fraction.padEnd(3, "0"))
  if (year === 0 || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label} ISO 日期部分无效。`)
  }
  if (zone !== "Z") {
    const offset = /[+-](\d{2}):(\d{2})$/.exec(zone)
    if (!offset || Number(offset[1]) > 23 || Number(offset[2]) > 59) {
      throw new Error(`${label}时区偏移无效。`)
    }
  }

  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  calendar.setUTCHours(hour, minute, second, millisecond)
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    throw new Error(`${label}日历日期无效。`)
  }

  const timestamp = Date.parse(value)
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < MIN_EPOCH_MILLISECONDS ||
    timestamp > MAX_EPOCH_MILLISECONDS
  ) {
    throw new Error(`${label}超出支持的日期范围。`)
  }
  return timestamp
}

function migrateToEpochMilliseconds(database) {
  database.exec("PRAGMA foreign_keys = OFF")
  try {
    database.exec("BEGIN IMMEDIATE")
    try {
      const asns = database.prepare("SELECT * FROM asns").all().map((record) => ({
        ...record,
        updated_at: toEpochMilliseconds(record.updated_at, `ASN ${record.asn} 更新时间`),
      }))
      const roas = database.prepare("SELECT * FROM roas").all().map((record) => ({
        ...record,
        updated_at: toEpochMilliseconds(record.updated_at, `ROA ${record.uuid} 更新时间`),
      }))

      database.exec(readFileSync(migrationPaths[1], "utf8"))
      const insertAsn = database.prepare(
        `INSERT INTO asns_epoch_ms
         (asn, country_code, subdivision_code, descr, remark, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      for (const record of asns) {
        insertAsn.run(
          record.asn,
          record.country_code,
          record.subdivision_code,
          record.descr,
          record.remark,
          record.updated_at
        )
      }

      const insertRoa = database.prepare(
        `INSERT INTO roas_epoch_ms
         (uuid, route, prefix_length, address_bits, max_length, asn, descr, remark,
          country_code, subdivision_code, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const record of roas) {
        insertRoa.run(
          record.uuid,
          record.route,
          record.prefix_length,
          record.address_bits,
          record.max_length,
          record.asn,
          record.descr,
          record.remark,
          record.country_code,
          record.subdivision_code,
          record.updated_at
        )
      }

      database.exec(`
        DROP TABLE roas;
        DROP TABLE asns;
        ALTER TABLE asns_epoch_ms RENAME TO asns;
        ALTER TABLE roas_epoch_ms RENAME TO roas;
        CREATE UNIQUE INDEX roas_tuple_unique
          ON roas(route, max_length, COALESCE(asn, -1));
        PRAGMA user_version = 2;
        COMMIT;
      `)
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  } finally {
    database.exec("PRAGMA foreign_keys = ON")
  }

  const violations = database.prepare("PRAGMA foreign_key_check").all()
  if (violations.length > 0) {
    throw new Error("数据库升级后存在外键错误，已停止使用该数据库。")
  }
}

export function resolveDatabasePath(databasePath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH) {
  return databasePath === ":memory:" ? databasePath : path.resolve(databasePath)
}

export function migrateDatabase(database) {
  let version = Number(database.prepare("PRAGMA user_version").get().user_version)
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`数据库版本 ${version} 高于当前支持版本 ${CURRENT_SCHEMA_VERSION}。`)
  }

  if (version < 1) {
    database.exec("BEGIN IMMEDIATE")
    try {
      database.exec(readFileSync(migrationPaths[0], "utf8"))
      database.exec("PRAGMA user_version = 1")
      database.exec("COMMIT")
      version = 1
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  }

  if (version < 2) {
    migrateToEpochMilliseconds(database)
    version = 2
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
