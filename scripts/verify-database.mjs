import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { importNetworkFile, NetworkOperationError, performNetworkOperation, getNetworkSnapshot } from "../lib/server/network-store.mjs"
import { migrateDatabaseFile } from "../lib/server/database.mjs"
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
  assert.equal(migrateDatabaseFile(), 1)
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
  assert.equal(getNetworkSnapshot().asns.some((item) => item.asn === 64515), true)
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
