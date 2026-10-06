import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"

import { openDatabase, toEpochMilliseconds } from "./database.mjs"
import { parseRouteCidr } from "./route-cidr.mjs"

const MAX_ASN = 4_294_967_295
const MAX_TEXT_LENGTH = 100_000

export class NetworkOperationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = "NetworkOperationError"
    this.status = status
  }
}

function fail(message, status = 400) {
  throw new NetworkOperationError(message, status)
}

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} 格式无效。`)
  }
  return value
}

function text(value, label, { allowEmpty = true } = {}) {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH || (!allowEmpty && !value.trim())) {
    fail(`${label}格式无效。`)
  }
  return value
}

function asnNumber(value, label = "ASN") {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ASN) {
    fail(`${label}必须是 1 到 4294967295 之间的整数。`)
  }
  return value
}

function geo(countryCode, subdivisionCode) {
  const country = text(countryCode, "国家代码")
  const subdivision = text(subdivisionCode, "省级代码")
  if (!/^(?:[A-Z]{2})?$/.test(country)) fail("国家代码必须留空或填写两个大写字母。")
  if (
    !/^(?:[A-Z0-9]{1,3})?$/.test(subdivision) ||
    (subdivision !== "" && country === "")
  ) {
    fail("省级代码必须留空或填写 1 到 3 位大写字母或数字；填写省级代码时必须提供国家代码。")
  }
  return { countryCode: country, subdivisionCode: subdivision }
}

function currentMaintainerUuid(database) {
  return database
    .prepare("SELECT value FROM metadata WHERE key = 'current_maintainer_uuid'")
    .get()?.value ?? null
}

function editableAsn(
  database,
  asn,
  viewerUuid,
  {
    nullable = false,
    permissionMessage = "当前用户不是该 ASN 的关联维护者，无法编辑。",
  } = {}
) {
  if (asn === null && nullable) return
  if (asn === null) fail("未关联 ASN 的 ROA 仅管理员可以操作。", 403)
  asnNumber(asn)
  const exists = database.prepare("SELECT 1 FROM asns WHERE asn = ?").get(asn)
  if (!exists) fail("关联的 ASN 不存在。", 404)
  if (!viewerUuid) fail(permissionMessage, 403)
  const permission = database
    .prepare("SELECT 1 FROM asn_maintainers WHERE asn = ? AND maintainer_uuid = ?")
    .get(asn, viewerUuid)
  if (!permission) fail(permissionMessage, 403)
}

function validateMaintainerLinks(database, value, viewerUuid, { requireViewer = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("至少需要关联一位已知维护者。")
  }
  if (new Set(value).size !== value.length) fail("维护者不能重复关联。")
  const exists = database.prepare("SELECT 1 FROM maintainers WHERE uuid = ?")
  for (const uuid of value) {
    if (typeof uuid !== "string" || !exists.get(uuid)) fail("关联的维护者不存在。")
  }
  if (requireViewer && (!viewerUuid || !value.includes(viewerUuid))) {
    fail("新建 ASN 必须关联当前有编辑权限的维护者。", 403)
  }
  return value
}

function snapshotFromDatabase(database) {
  const viewerUuid = currentMaintainerUuid(database)
  const maintainers = database
    .prepare("SELECT uuid, name, remark, source FROM maintainers ORDER BY rowid")
    .all()
    .map((record) => ({
      uuid: record.uuid,
      name: record.name,
      remark: record.remark,
      source: record.source,
      canEdit: record.uuid === viewerUuid,
      isMine: record.uuid === viewerUuid,
    }))

  const asns = database
    .prepare(
      "SELECT asn, country_code, subdivision_code, descr, remark, updated_at FROM asns ORDER BY asn"
    )
    .all()
    .map((record) => ({
      asn: record.asn,
      maintainerUuids: database
        .prepare("SELECT maintainer_uuid FROM asn_maintainers WHERE asn = ? ORDER BY rowid")
        .all(record.asn)
        .map((row) => row.maintainer_uuid),
      countryCode: record.country_code,
      subdivisionCode: record.subdivision_code,
      descr: record.descr,
      remark: record.remark,
      updatedAt: record.updated_at,
    }))

  const roas = database
    .prepare(
      `SELECT uuid, route, max_length, asn, descr, remark, country_code,
              subdivision_code, updated_at FROM roas ORDER BY route, max_length, uuid`
    )
    .all()
    .map((record) => ({
      uuid: record.uuid,
      route: record.route,
      maxLength: record.max_length,
      asn: record.asn,
      descr: record.descr,
      remark: record.remark,
      countryCode: record.country_code,
      subdivisionCode: record.subdivision_code,
      updatedAt: record.updated_at,
    }))

  return { maintainers, asns, roas, isAdmin: false }
}

function closeAfter(database, fn) {
  try {
    return fn(database)
  } finally {
    database.close()
  }
}

export function getNetworkSnapshot() {
  const database = openDatabase()
  return closeAfter(database, (db) => {
    db.exec("BEGIN")
    try {
      const snapshot = snapshotFromDatabase(db)
      db.exec("COMMIT")
      return snapshot
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  })
}

function saveAsnMaintainers(database, asn, uuids) {
  database.prepare("DELETE FROM asn_maintainers WHERE asn = ?").run(asn)
  const insert = database.prepare(
    "INSERT INTO asn_maintainers (asn, maintainer_uuid) VALUES (?, ?)"
  )
  for (const uuid of uuids) insert.run(asn, uuid)
}

function validateRoaFields(record, database, viewerUuid, { original = null } = {}) {
  const uuid = text(record.uuid, "ROA UUID", { allowEmpty: false })
  const parsed = parseRouteCidr(record.route)
  if (!parsed) {
    const raw = typeof record.route === "string" ? record.route.trim() : ""
    const prefixText = raw.split("/")[1]
    if (prefixText !== undefined && /^\d+$/.test(prefixText)) {
      fail("CIDR 地址或前缀无效，且网络地址不能包含主机位。")
    }
    fail("请输入有效的 IPv4 或 IPv6 CIDR，例如 192.0.2.0/24。")
  }

  if (
    !Number.isInteger(record.maxLength) ||
    record.maxLength < parsed.prefixLength ||
    record.maxLength > parsed.addressBits
  ) {
    fail(`maxLength 必须是 ${parsed.prefixLength} 到 ${parsed.addressBits} 之间的整数。`)
  }

  const coordinates = geo(record.countryCode, record.subdivisionCode)
  if (original) {
    editableAsn(database, original.asn, viewerUuid, {
      permissionMessage: "没有权限编辑原 ROA 关联的 ASN。",
    })
  }
  editableAsn(database, record.asn, viewerUuid)

  const duplicate = database
    .prepare(
      `SELECT 1 FROM roas
       WHERE route = ? AND max_length = ? AND asn IS ? AND uuid <> ?`
    )
    .get(parsed.route, record.maxLength, record.asn, uuid)
  if (duplicate) fail("相同的路由、最大前缀长度和 ASN 已存在。", 409)

  return {
    uuid,
    route: parsed.route,
    prefixLength: parsed.prefixLength,
    addressBits: parsed.addressBits,
    maxLength: record.maxLength,
    asn: record.asn,
    descr: text(record.descr, "描述"),
    remark: text(record.remark, "备注"),
    ...coordinates,
  }
}

function insertRoa(database, record, updatedAt) {
  database
    .prepare(
      `INSERT INTO roas
       (uuid, route, prefix_length, address_bits, max_length, asn, descr, remark,
        country_code, subdivision_code, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.uuid,
      record.route,
      record.prefixLength,
      record.addressBits,
      record.maxLength,
      record.asn,
      record.descr,
      record.remark,
      record.countryCode,
      record.subdivisionCode,
      updatedAt
    )
}

function updateRoa(database, record, updatedAt) {
  database
    .prepare(
      `UPDATE roas SET route = ?, prefix_length = ?, address_bits = ?, max_length = ?,
       asn = ?, descr = ?, remark = ?, country_code = ?, subdivision_code = ?, updated_at = ?
       WHERE uuid = ?`
    )
    .run(
      record.route,
      record.prefixLength,
      record.addressBits,
      record.maxLength,
      record.asn,
      record.descr,
      record.remark,
      record.countryCode,
      record.subdivisionCode,
      updatedAt,
      record.uuid
    )
}

function applyOperation(database, payload) {
  const operation = payload.operation
  const viewerUuid = currentMaintainerUuid(database)
  const now = Date.now()

  if (operation === "saveMaintainer") {
    const record = asObject(payload.record, "维护者记录")
    const uuid = text(record.uuid, "维护者 UUID", { allowEmpty: false })
    const existing = database
      .prepare("SELECT uuid FROM maintainers WHERE uuid = ?")
      .get(uuid)
    if (!existing) fail("未找到该维护者记录。", 404)
    if (!viewerUuid || uuid !== viewerUuid) fail("没有权限编辑该维护者。", 403)
    database
      .prepare("UPDATE maintainers SET name = ?, remark = ? WHERE uuid = ?")
      .run(text(record.name, "名称", { allowEmpty: false }), text(record.remark, "备注"), uuid)
    return
  }

  if (operation === "createAsn") {
    const record = asObject(payload.record, "ASN 记录")
    const asn = asnNumber(record.asn)
    if (database.prepare("SELECT 1 FROM asns WHERE asn = ?").get(asn)) {
      fail("该 ASN 已存在。", 409)
    }
    const maintainerUuids = validateMaintainerLinks(database, record.maintainerUuids, viewerUuid, {
      requireViewer: true,
    })
    const coordinates = geo(record.countryCode, record.subdivisionCode)
    database
      .prepare(
        `INSERT INTO asns
         (asn, country_code, subdivision_code, descr, remark, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        asn,
        coordinates.countryCode,
        coordinates.subdivisionCode,
        text(record.descr, "描述"),
        text(record.remark, "备注"),
        now
      )
    saveAsnMaintainers(database, asn, maintainerUuids)
    return
  }

  if (operation === "saveAsn") {
    const record = asObject(payload.record, "ASN 记录")
    const asn = asnNumber(record.asn)
    if (!database.prepare("SELECT 1 FROM asns WHERE asn = ?").get(asn)) {
      fail("未找到该 ASN 记录。", 404)
    }
    editableAsn(database, asn, viewerUuid)
    const maintainerUuids = validateMaintainerLinks(database, record.maintainerUuids, viewerUuid)
    const coordinates = geo(record.countryCode, record.subdivisionCode)
    database
      .prepare(
        `UPDATE asns SET country_code = ?, subdivision_code = ?, descr = ?, remark = ?, updated_at = ?
         WHERE asn = ?`
      )
      .run(
        coordinates.countryCode,
        coordinates.subdivisionCode,
        text(record.descr, "描述"),
        text(record.remark, "备注"),
        now,
        asn
      )
    saveAsnMaintainers(database, asn, maintainerUuids)
    return
  }

  if (operation === "deleteAsn") {
    const asn = asnNumber(payload.asn)
    editableAsn(database, asn, viewerUuid)
    if (database.prepare("SELECT 1 FROM roas WHERE asn = ? LIMIT 1").get(asn)) {
      fail("该 ASN 正被 ROA 引用，无法删除。", 409)
    }
    database.prepare("DELETE FROM asns WHERE asn = ?").run(asn)
    return
  }

  if (operation === "createRoa") {
    const record = asObject(payload.record, "ROA 记录")
    const uuid = text(record.uuid, "ROA UUID", { allowEmpty: false })
    if (database.prepare("SELECT 1 FROM roas WHERE uuid = ?").get(uuid)) {
      fail("ROA UUID 已存在。", 409)
    }
    const validated = validateRoaFields({ ...record, uuid }, database, viewerUuid)
    insertRoa(database, validated, now)
    return
  }

  if (operation === "saveRoa") {
    const record = asObject(payload.record, "ROA 记录")
    const uuid = text(record.uuid, "ROA UUID", { allowEmpty: false })
    const original = database
      .prepare("SELECT uuid, asn FROM roas WHERE uuid = ?")
      .get(uuid)
    if (!original) fail("未找到该 ROA 记录。", 404)
    const validated = validateRoaFields({ ...record, uuid }, database, viewerUuid, { original })
    updateRoa(database, validated, now)
    return
  }

  if (operation === "deleteRoa") {
    const uuid = text(payload.uuid, "ROA UUID", { allowEmpty: false })
    const original = database
      .prepare("SELECT uuid, asn FROM roas WHERE uuid = ?")
      .get(uuid)
    if (!original) fail("未找到该 ROA 记录。", 404)
    editableAsn(database, original.asn, viewerUuid, {
      permissionMessage: "没有权限删除原 ROA 关联的 ASN。",
    })
    database.prepare("DELETE FROM roas WHERE uuid = ?").run(uuid)
    return
  }

  fail("不支持的网络数据操作。")
}

function translateSqliteError(error) {
  if (error instanceof NetworkOperationError) return error
  const code = String(error?.code ?? "")
  const message = String(error?.message ?? "")
  if (
    code.includes("CONSTRAINT_UNIQUE") ||
    code.includes("CONSTRAINT_PRIMARYKEY") ||
    /UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(message)
  ) {
    return new NetworkOperationError("记录已存在或与现有数据冲突。", 409)
  }
  if (code.includes("CONSTRAINT_FOREIGNKEY") || /FOREIGN KEY constraint failed/i.test(message)) {
    return new NetworkOperationError("关联记录不存在或仍被引用，无法完成操作。", 409)
  }
  if (
    code.includes("CONSTRAINT_CHECK") ||
    code.includes("CONSTRAINT_NOTNULL") ||
    /CHECK constraint failed|NOT NULL constraint failed/i.test(message)
  ) {
    return new NetworkOperationError("提交的数据不符合字段约束。")
  }
  return error
}

export function performNetworkOperation(payload) {
  const database = openDatabase()
  try {
    database.exec("BEGIN IMMEDIATE")
    try {
      applyOperation(database, asObject(payload, "请求数据"))
      const data = snapshotFromDatabase(database)
      database.exec("COMMIT")
      return { error: null, data }
    } catch (error) {
      database.exec("ROLLBACK")
      throw translateSqliteError(error)
    }
  } finally {
    database.close()
  }
}

function importCount(database) {
  return Number(
    database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM maintainers) +
          (SELECT COUNT(*) FROM asns) +
          (SELECT COUNT(*) FROM roas) +
          (SELECT COUNT(*) FROM import_provenance) AS count`
      )
      .get().count
  )
}

function validateImportDataset(dataset) {
  asObject(dataset, "导入数据")
  if (dataset.version !== 1) fail("仅支持 version 为 1 的网络数据。")
  if (!Array.isArray(dataset.maintainers) || !Array.isArray(dataset.asns) || !Array.isArray(dataset.roas)) {
    fail("导入数据缺少维护者、ASN 或 ROA 列表。")
  }
  const maintainers = new Map()
  for (const item of dataset.maintainers) {
    asObject(item, "维护者")
    const uuid = text(item.uuid, "维护者 UUID", { allowEmpty: false })
    if (maintainers.has(uuid)) fail("导入数据包含重复维护者 UUID。")
    maintainers.set(uuid, {
      uuid,
      name: text(item.name, "维护者名称", { allowEmpty: false }),
      remark: text(item.remark, "维护者备注"),
      source: text(item.source, "维护者来源", { allowEmpty: false }),
    })
  }

  const asns = new Map()
  for (const item of dataset.asns) {
    asObject(item, "ASN")
    const asn = asnNumber(item.asn)
    if (asns.has(asn)) fail("导入数据包含重复 ASN。")
    if (!Array.isArray(item.maintainerUuids) || new Set(item.maintainerUuids).size !== item.maintainerUuids.length) {
      fail("ASN 维护者列表格式无效或包含重复项。")
    }
    for (const uuid of item.maintainerUuids) {
      if (!maintainers.has(uuid)) fail("ASN 引用了不存在的维护者。")
    }
    const coordinates = geo(item.countryCode, item.subdivisionCode)
    asns.set(asn, {
      asn,
      maintainerUuids: item.maintainerUuids,
      ...coordinates,
      descr: text(item.descr, "ASN 描述"),
      remark: text(item.remark, "ASN 备注"),
      updatedAt: toEpochMilliseconds(item.updatedAt, "ASN 更新时间"),
    })
  }

  const roas = []
  const tupleKeys = new Set()
  const uuidSet = new Set()
  for (const item of dataset.roas) {
    asObject(item, "ROA")
    const uuid = text(item.uuid, "ROA UUID", { allowEmpty: false })
    if (uuidSet.has(uuid)) fail("导入数据包含重复 ROA UUID。")
    uuidSet.add(uuid)
    const parsed = parseRouteCidr(item.route)
    if (!parsed) fail("导入数据包含无效 CIDR 或包含主机位的网络地址。")
    if (!Number.isInteger(item.maxLength) || item.maxLength < parsed.prefixLength || item.maxLength > parsed.addressBits) {
      fail("导入数据包含无效 ROA maxLength。")
    }
    if (item.asn !== null && !asns.has(asnNumber(item.asn))) {
      fail("ROA 引用了不存在的 ASN。")
    }
    const coordinates = geo(item.countryCode, item.subdivisionCode)
    const tuple = JSON.stringify([parsed.route, item.maxLength, item.asn])
    if (tupleKeys.has(tuple)) fail("导入数据包含重复 ROA 路由授权。")
    tupleKeys.add(tuple)
    roas.push({
      uuid,
      route: parsed.route,
      prefixLength: parsed.prefixLength,
      addressBits: parsed.addressBits,
      maxLength: item.maxLength,
      asn: item.asn,
      descr: text(item.descr, "ROA 描述"),
      remark: text(item.remark, "ROA 备注"),
      ...coordinates,
      updatedAt: toEpochMilliseconds(item.updatedAt, "ROA 更新时间"),
    })
  }

  const currentMaintainerUuid = text(dataset.currentMaintainerUuid, "当前维护者 UUID", {
    allowEmpty: false,
  })
  if (!maintainers.has(currentMaintainerUuid)) fail("当前维护者 UUID 不在导入维护者列表中。")
  return { maintainers: [...maintainers.values()], asns: [...asns.values()], roas, currentMaintainerUuid }
}

function insertImport(database, dataset, contentHash, sourcePath) {
  const normalized = validateImportDataset(dataset)
  database.exec("BEGIN IMMEDIATE")
  try {
    if (importCount(database) > 0) {
      const previous = database
        .prepare("SELECT content_sha256 FROM import_provenance WHERE id = 1")
        .get()
      if (previous?.content_sha256 === contentHash) {
        database.exec("COMMIT")
        return { imported: false, alreadyImported: true }
      }
      fail("数据库非空且导入来源不同；为避免覆盖数据，已拒绝导入。", 409)
    }

    const insertMaintainer = database.prepare(
      "INSERT INTO maintainers (uuid, name, remark, source) VALUES (?, ?, ?, ?)"
    )
    for (const item of normalized.maintainers) {
      insertMaintainer.run(item.uuid, item.name, item.remark, item.source)
    }

    const insertAsn = database.prepare(
      `INSERT INTO asns (asn, country_code, subdivision_code, descr, remark, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const item of normalized.asns) {
      insertAsn.run(
        item.asn,
        item.countryCode,
        item.subdivisionCode,
        item.descr,
        item.remark,
        item.updatedAt
      )
      const insertLink = database.prepare(
        "INSERT INTO asn_maintainers (asn, maintainer_uuid) VALUES (?, ?)"
      )
      for (const uuid of item.maintainerUuids) insertLink.run(item.asn, uuid)
    }

    for (const item of normalized.roas) insertRoa(database, item, item.updatedAt)
    database
      .prepare("INSERT INTO metadata (key, value) VALUES ('current_maintainer_uuid', ?)")
      .run(normalized.currentMaintainerUuid)
    database
      .prepare(
        `INSERT INTO import_provenance
         (id, content_sha256, imported_at, source_path, provenance_json)
         VALUES (1, ?, ?, ?, ?)`
      )
      .run(
        contentHash,
        new Date().toISOString(),
        path.resolve(sourcePath),
        JSON.stringify(dataset.provenance ?? null)
      )
    database.exec("COMMIT")
    return { imported: true, alreadyImported: false }
  } catch (error) {
    database.exec("ROLLBACK")
    throw translateSqliteError(error)
  }
}

export function importNetworkFile(sourcePath) {
  const resolvedSourcePath = path.resolve(sourcePath)
  const content = readFileSync(resolvedSourcePath)
  const dataset = JSON.parse(content.toString("utf8"))
  const contentHash = createHash("sha256").update(content).digest("hex")
  const database = openDatabase()
  try {
    return insertImport(database, dataset, contentHash, resolvedSourcePath)
  } finally {
    database.close()
  }
}
