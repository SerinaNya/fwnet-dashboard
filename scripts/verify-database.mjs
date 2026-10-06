import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { importNetworkFile, NetworkOperationError, performNetworkOperation, getNetworkSnapshot } from "../lib/server/network-store.mjs"
import { migrateDatabaseFile, openDatabase, toEpochMilliseconds } from "../lib/server/database.mjs"
import { parseRouteCidr } from "../lib/server/route-cidr.mjs"

const ownerUuid = "owner-uuid"
const readonlyUuid = "readonly-uuid"
const previousDatabasePath = process.env.DATABASE_PATH
const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "fwnet-db-verify-"))
const databasePath = path.join(tempDirectory, "verify.sqlite")
const datasetPath = path.join(tempDirectory, "network.json")
process.env.DATABASE_PATH = databasePath

function expectFailure(operation, status, fragment) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof NetworkOperationError)
    assert.equal(error.status, status)
    assert.ok(error.message.includes(fragment), error.message)
    return true
  })
}

function createVersionOneFixture(
  filePath,
  { invalidTimestamp = false, invalidRoaTimestamp = false } = {}
) {
  const database = new DatabaseSync(filePath)
  database.exec("PRAGMA foreign_keys = ON")
  database.exec(readFileSync(path.resolve("lib/server/migrations/001-initial.sql"), "utf8"))
  database.prepare("INSERT INTO maintainers VALUES (?, ?, ?, ?)").run(ownerUuid, "Owner", "remark", "fwnet")
  database.prepare("INSERT INTO maintainers VALUES (?, ?, ?, ?)").run(readonlyUuid, "Other", "", "community")
  const insertAsn = database.prepare("INSERT INTO asns VALUES (?, ?, ?, ?, ?, ?)")
  insertAsn.run(
    64512,
    "CN",
    "SH",
    "ASN fixture",
    "",
    invalidTimestamp ? "not a timestamp" : "2024-03-01T00:00:00.123Z"
  )
  insertAsn.run(64513, "", "", "Unassigned ASN", "", "2024-03-01T00:00:00.000Z")
  database.prepare("INSERT INTO asn_maintainers VALUES (?, ?)").run(64512, ownerUuid)
  const insertRoa = database.prepare("INSERT INTO roas VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
  insertRoa.run(
    "fixture-roa-asn", "192.0.2.0/24", 24, 32, 24, 64512, "ASN ROA", "", "CN", "SH",
    "2024-03-01T08:00:00.456+08:00"
  )
  insertRoa.run(
    "fixture-roa-null", "2001:db8::/32", 32, 128, 48, null, "Null ASN ROA", "", "", "",
    invalidRoaTimestamp ? "bad ROA timestamp" : "2024-03-01T00:00:00.789Z"
  )
  database.prepare("INSERT INTO metadata VALUES (?, ?)").run("current_maintainer_uuid", ownerUuid)
  database.prepare("INSERT INTO import_provenance VALUES (?, ?, ?, ?, ?)").run(
    1, "fixture-content-hash", "2024-03-02T00:00:00.000Z", "fixture/network.json",
    '{"raw":{"kept":true}}'
  )
  database.exec("PRAGMA user_version = 1")
  database.close()
}

function verifyVersionOneMigration() {
  const validPath = path.join(tempDirectory, "v1-valid.sqlite")
  createVersionOneFixture(validPath)
  assert.equal(migrateDatabaseFile(validPath), 2)

  let database = openDatabase(validPath)
  try {
    const asnTimestamp = database
      .prepare("SELECT updated_at, typeof(updated_at) AS storage FROM asns WHERE asn = 64512")
      .get()
    assert.equal(asnTimestamp.storage, "integer")
    assert.equal(asnTimestamp.updated_at, Date.parse("2024-03-01T00:00:00.123Z"))
    const roaTimestamps = database
      .prepare("SELECT uuid, updated_at, typeof(updated_at) AS storage FROM roas ORDER BY uuid")
      .all()
      .map((record) => ({ ...record }))
    assert.deepEqual(roaTimestamps, [
      {
        uuid: "fixture-roa-asn",
        updated_at: Date.parse("2024-03-01T00:00:00.456Z"),
        storage: "integer",
      },
      {
        uuid: "fixture-roa-null",
        updated_at: Date.parse("2024-03-01T00:00:00.789Z"),
        storage: "integer",
      },
    ])
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM asn_maintainers WHERE asn = 64512 AND maintainer_uuid = ?").get(ownerUuid).count,
      1
    )
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM asns").get().count, 2)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM roas").get().count, 2)
    assert.equal(
      database.prepare("SELECT value FROM metadata WHERE key = 'current_maintainer_uuid'").get().value,
      ownerUuid
    )
    assert.deepEqual({ ...database.prepare("SELECT * FROM import_provenance").get() }, {
      id: 1,
      content_sha256: "fixture-content-hash",
      imported_at: "2024-03-02T00:00:00.000Z",
      source_path: "fixture/network.json",
      provenance_json: '{"raw":{"kept":true}}',
    })
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 2)
    assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1)
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
    assert.throws(() => database.prepare("DELETE FROM asns WHERE asn = 64512").run(), /FOREIGN KEY constraint failed/)
    assert.throws(
      () => database.prepare(
        `INSERT INTO roas VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "fixture-roa-duplicate", "192.0.2.0/24", 24, 32, 24, 64512, "duplicate", "", "CN", "SH", 1
      ),
      /UNIQUE constraint failed/
    )
  } finally {
    database.close()
  }

  assert.equal(migrateDatabaseFile(validPath), 2)
  database = openDatabase(validPath)
  try {
    assert.equal(
      database.prepare("SELECT updated_at FROM asns WHERE asn = 64512").get().updated_at,
      Date.parse("2024-03-01T00:00:00.123Z")
    )
  } finally {
    database.close()
  }

  const invalidPath = path.join(tempDirectory, "v1-invalid.sqlite")
  createVersionOneFixture(invalidPath, { invalidTimestamp: true })
  assert.throws(() => migrateDatabaseFile(invalidPath), /ISO 日期/)
  database = new DatabaseSync(invalidPath)
  try {
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 1)
    const original = database
      .prepare("SELECT typeof(updated_at) AS storage, updated_at FROM asns WHERE asn = 64512")
      .get()
    assert.deepEqual({ ...original }, { storage: "text", updated_at: "not a timestamp" })
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'asns_epoch_ms'").get().count,
      0
    )
  } finally {
    database.close()
  }

  const invalidRoaPath = path.join(tempDirectory, "v1-invalid-roa.sqlite")
  createVersionOneFixture(invalidRoaPath, { invalidRoaTimestamp: true })
  assert.throws(() => migrateDatabaseFile(invalidRoaPath), /ISO 日期/)
  database = new DatabaseSync(invalidRoaPath)
  try {
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 1)
    assert.equal(
      database.prepare("SELECT updated_at FROM roas WHERE uuid = 'fixture-roa-null'").get().updated_at,
      "bad ROA timestamp"
    )
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'roas_epoch_ms'").get().count,
      0
    )
  } finally {
    database.close()
  }
}

const dataset = {
  version: 1,
  currentMaintainerUuid: ownerUuid,
  maintainers: [
    { uuid: ownerUuid, name: "Owner", remark: "", source: "fwnet" },
    { uuid: readonlyUuid, name: "ReadOnly", remark: "", source: "fwnet" },
  ],
  asns: [
    {
      asn: 64512,
      maintainerUuids: [ownerUuid],
      countryCode: "CN",
      subdivisionCode: "SH",
      descr: "Owner ASN",
      remark: "",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      asn: 64513,
      maintainerUuids: [readonlyUuid],
      countryCode: "",
      subdivisionCode: "",
      descr: "Read-only ASN",
      remark: "",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      asn: 64514,
      maintainerUuids: [],
      countryCode: "",
      subdivisionCode: "",
      descr: "Unassigned ASN",
      remark: "",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
  roas: [
    {
      uuid: "roa-owner",
      route: "192.0.2.0/24",
      maxLength: 24,
      asn: 64512,
      descr: "Owner ROA",
      remark: "",
      countryCode: "CN",
      subdivisionCode: "SH",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      uuid: "roa-readonly",
      route: "2001:db8::/32",
      maxLength: 48,
      asn: 64513,
      descr: "Read-only ROA",
      remark: "",
      countryCode: "CN",
      subdivisionCode: "",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      uuid: "roa-null",
      route: "203.0.113.0/24",
      maxLength: 24,
      asn: null,
      descr: "Unassigned ROA",
      remark: "",
      countryCode: "",
      subdivisionCode: "",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
  provenance: { raw: { fixture: true } },
}

try {
  assert.equal(toEpochMilliseconds("2024-03-01T08:00:00.123+08:00"), Date.parse("2024-03-01T00:00:00.123Z"))
  assert.equal(toEpochMilliseconds(1736928000000), 1736928000000)
  assert.throws(() => toEpochMilliseconds(1.5), /整数毫秒/)
  verifyVersionOneMigration()

  assert.equal(migrateDatabaseFile(), 2)
  assert.deepEqual(getNetworkSnapshot(), {
    maintainers: [],
    asns: [],
    roas: [],
    isAdmin: false,
  })

  writeFileSync(datasetPath, JSON.stringify(dataset))
  assert.deepEqual(importNetworkFile(datasetPath), { imported: true, alreadyImported: false })
  assert.deepEqual(importNetworkFile(datasetPath), { imported: false, alreadyImported: true })
  const initial = getNetworkSnapshot()
  assert.equal(initial.maintainers.find((item) => item.uuid === ownerUuid)?.canEdit, true)
  assert.equal(initial.maintainers.find((item) => item.uuid === readonlyUuid)?.canEdit, false)
  assert.equal(initial.asns.find((item) => item.asn === 64514)?.maintainerUuids.length, 0)
  assert.equal(initial.asns.find((item) => item.asn === 64512)?.updatedAt, Date.parse("2024-01-01T00:00:00.000Z"))
  assert.equal(initial.roas.find((item) => item.uuid === "roa-null")?.asn, null)

  assert.deepEqual(parseRouteCidr("2001:0db8:0001:0000:0000:0000:0000:0000/48"), {
    route: "2001:db8:1::/48",
    prefixLength: 48,
    addressBits: 128,
  })
  assert.equal(parseRouteCidr("192.0.2.1/24"), null)

  expectFailure(
    () => performNetworkOperation({ operation: "createAsn", record: {
      asn: 64515,
      maintainerUuids: [readonlyUuid],
      countryCode: "",
      subdivisionCode: "",
      descr: "Denied",
      remark: "",
    } }),
    403,
    "当前有编辑权限"
  )

  performNetworkOperation({ operation: "createAsn", record: {
    asn: 64515,
    maintainerUuids: [ownerUuid],
    countryCode: "CN",
    subdivisionCode: "",
    descr: "Created ASN",
    remark: "",
  } })
  const createdAsn = getNetworkSnapshot().asns.find((item) => item.asn === 64515)
  assert.equal(Number.isSafeInteger(createdAsn?.updatedAt), true)
  performNetworkOperation({ operation: "saveMaintainer", record: {
    uuid: ownerUuid,
    name: "Owner Updated",
    remark: "Updated",
    source: "untrusted-source",
    canEdit: false,
    isMine: false,
  } })
  performNetworkOperation({ operation: "saveAsn", record: {
    asn: 64515,
    maintainerUuids: [ownerUuid],
    countryCode: "CN",
    subdivisionCode: "SH",
    descr: "Updated ASN",
    remark: "Updated",
    updatedAt: "untrusted",
  } })
  assert.equal(getNetworkSnapshot().maintainers.find((item) => item.uuid === ownerUuid)?.source, "fwnet")
  assert.equal(getNetworkSnapshot().asns.find((item) => item.asn === 64515)?.descr, "Updated ASN")
  assert.equal(Number.isSafeInteger(getNetworkSnapshot().asns.find((item) => item.asn === 64515)?.updatedAt), true)
  expectFailure(
    () => performNetworkOperation({ operation: "saveAsn", record: {
      asn: 64513,
      maintainerUuids: [readonlyUuid],
      countryCode: "",
      subdivisionCode: "",
      descr: "Denied",
      remark: "",
    } }),
    403,
    "不是该 ASN"
  )

  const newRoa = {
    uuid: "roa-created",
    route: "2001:0db8:0001:0000:0000:0000:0000:0000/48",
    maxLength: 64,
    asn: 64515,
    descr: "Created ROA",
    remark: "",
    countryCode: "CN",
    subdivisionCode: "SH",
  }
  performNetworkOperation({ operation: "createRoa", record: newRoa })
  assert.equal(getNetworkSnapshot().roas.find((item) => item.uuid === newRoa.uuid)?.route, "2001:db8:1::/48")
  assert.equal(Number.isSafeInteger(getNetworkSnapshot().roas.find((item) => item.uuid === newRoa.uuid)?.updatedAt), true)

  expectFailure(
    () => performNetworkOperation({ operation: "createRoa", record: { ...newRoa, uuid: "roa-null-create", asn: null } }),
    403,
    "仅管理员"
  )
  expectFailure(
    () => performNetworkOperation({ operation: "createRoa", record: { ...newRoa, uuid: "roa-readonly-create", asn: 64513 } }),
    403,
    "不是该 ASN"
  )
  expectFailure(
    () => performNetworkOperation({ operation: "createRoa", record: { ...newRoa, uuid: "roa-host-bits", route: "192.0.2.1/24", asn: 64512 } }),
    400,
    "主机位"
  )
  expectFailure(
    () => performNetworkOperation({ operation: "createRoa", record: { ...newRoa, uuid: "roa-duplicate", route: "2001:db8:1::/48", asn: 64515 } }),
    409,
    "已存在"
  )

  performNetworkOperation({ operation: "saveRoa", record: {
    ...newRoa,
    route: "198.51.100.0/24",
    maxLength: 28,
    updatedAt: "untrusted",
  } })
  assert.notEqual(getNetworkSnapshot().roas.find((item) => item.uuid === newRoa.uuid)?.updatedAt, "untrusted")
  expectFailure(
    () => performNetworkOperation({ operation: "saveRoa", record: { ...initial.roas[1], descr: "Changed" } }),
    403,
    "没有权限编辑原 ROA"
  )
  expectFailure(
    () => performNetworkOperation({ operation: "deleteRoa", uuid: "roa-null" }),
    403,
    "仅管理员"
  )
  expectFailure(
    () => performNetworkOperation({ operation: "deleteAsn", asn: 64512 }),
    409,
    "ROA 引用"
  )

  performNetworkOperation({ operation: "deleteRoa", uuid: "roa-created" })
  performNetworkOperation({ operation: "deleteRoa", uuid: "roa-owner" })
  performNetworkOperation({ operation: "deleteAsn", asn: 64512 })
  performNetworkOperation({ operation: "deleteAsn", asn: 64515 })
  expectFailure(
    () => performNetworkOperation({ operation: "deleteAsn", asn: 64513 }),
    403,
    "不是该 ASN"
  )

  const changedDataset = { ...dataset, maintainers: dataset.maintainers.map((item) => ({ ...item, name: `${item.name} changed` })) }
  writeFileSync(datasetPath, JSON.stringify(changedDataset))
  expectFailure(() => importNetworkFile(datasetPath), 409, "数据库非空")
  const reopened = getNetworkSnapshot()
  assert.equal(reopened.asns.some((item) => item.asn === 64512), false)
  assert.equal(reopened.asns.some((item) => item.asn === 64515), false)
  assert.equal(reopened.roas.some((item) => item.uuid === "roa-created"), false)

  console.log("Database verification passed.")
} finally {
  if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = previousDatabasePath
  rmSync(tempDirectory, { recursive: true, force: true })
}
