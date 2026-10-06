export type Maintainer = {
  uuid: string
  name: string
  remark: string
  source: string
  canEdit: boolean
  isMine: boolean
}

export type AsnRecord = {
  asn: number
  maintainerUuids: string[]
  countryCode: string
  subdivisionCode: string
  descr: string
  remark: string
  updatedAt: number
}

export type RoaRecord = {
  uuid: string
  route: string
  maxLength: number
  asn: number | null
  descr: string
  remark: string
  countryCode: string
  subdivisionCode: string
  updatedAt: number
}

export const initialMaintainers: Maintainer[] = [
  {
    uuid: "b762c4e1-58d3-4d7b-9a31-0c8f2a6e51d4",
    name: "SerinaNya",
    remark: "负责核心路由与网络策略的日常维护。",
    source: "fwnet",
    canEdit: true,
    isMine: true,
  },
  {
    uuid: "3a91e6f0-2c47-4b8d-a135-6f09d2c87e42",
    name: "ShakaiAneE",
    remark: "",
    source: "fwnet",
    canEdit: false,
    isMine: false,
  },
]

export const initialAsns: AsnRecord[] = [
  {
    asn: 64512,
    maintainerUuids: [initialMaintainers[0].uuid, initialMaintainers[1].uuid],
    countryCode: "CN",
    subdivisionCode: "SH",
    descr: "FWNET-SHARED",
    remark: "",
    updatedAt: 1736928000000,
  },
  {
    asn: 64513,
    maintainerUuids: [initialMaintainers[1].uuid],
    countryCode: "CN",
    subdivisionCode: "",
    descr: "FWNET-READONLY",
    remark: "",
    updatedAt: 1736928000000,
  },
  {
    asn: 64514,
    maintainerUuids: [initialMaintainers[0].uuid],
    countryCode: "",
    subdivisionCode: "",
    descr: "FWNET-PRIVATE",
    remark: "",
    updatedAt: 1736928000000,
  },
]

export const initialRoas: RoaRecord[] = [
  {
    uuid: "roa-192-0-2-64512",
    route: "192.0.2.0/24",
    maxLength: 24,
    asn: 64512,
    descr: "FWNET-DOCS-IPV4",
    remark: "",
    countryCode: "CN",
    subdivisionCode: "SH",
    updatedAt: 1736928000000,
  },
  {
    uuid: "roa-2001-db8-64513",
    route: "2001:db8::/32",
    maxLength: 48,
    asn: 64513,
    descr: "FWNET-DOCS-IPV6",
    remark: "只读 ASN 示例",
    countryCode: "CN",
    subdivisionCode: "",
    updatedAt: 1736928000000,
  },
]

function validateAsnNumber(asn: number): string | null {
  if (!Number.isInteger(asn) || asn < 1 || asn > 4_294_967_295) {
    return "ASN 必须是 1 到 4294967295 之间的整数。"
  }
  return null
}

function validateMaintainerUuids(uuids: string[], maintainers: Maintainer[]): string | null {
  if (
    !Array.isArray(uuids) ||
    uuids.length === 0 ||
    new Set(uuids).size !== uuids.length ||
    uuids.some((uuid) => !maintainers.some((maintainer) => maintainer.uuid === uuid))
  ) {
    return "请至少选择一位已知维护者，且不能重复选择。"
  }
  return null
}

export function validateGeoCodes(countryCode: string, subdivisionCode: string): string | null {
  if (typeof countryCode !== "string" || !/^(?:[A-Z]{2})?$/.test(countryCode)) {
    return "国家代码必须留空或填写两个大写字母。"
  }

  if (
    typeof subdivisionCode !== "string" ||
    !/^(?:[A-Z0-9]{1,3})?$/.test(subdivisionCode) ||
    (subdivisionCode !== "" && countryCode === "")
  ) {
    return "省级代码必须留空或填写 1 到 3 位大写字母或数字；填写省级代码时必须提供国家代码。"
  }

  return null
}

export function validateAsnRecord(
  record: AsnRecord,
  maintainers: Maintainer[],
  existingAsns: AsnRecord[]
): string | null {
  const asnError = validateAsnNumber(record.asn)
  if (asnError) return asnError

  const original = existingAsns.find((existing) => existing.asn === record.asn)
  if (!original) return "未找到该 ASN 记录，目前仅支持编辑已有记录。"

  const canEdit = original.maintainerUuids.some((uuid) =>
    maintainers.some((maintainer) => maintainer.uuid === uuid && maintainer.canEdit)
  )
  if (!canEdit) return "您没有权限编辑此 ASN。"

  const maintainerError = validateMaintainerUuids(record.maintainerUuids, maintainers)
  if (maintainerError) return maintainerError

  return validateGeoCodes(record.countryCode, record.subdivisionCode)
}

export function validateNewAsnRecord(
  record: AsnRecord,
  maintainers: Maintainer[],
  existingAsns: AsnRecord[]
): string | null {
  const asnError = validateAsnNumber(record.asn)
  if (asnError) return asnError

  if (existingAsns.some((existing) => existing.asn === record.asn)) {
    return "该 ASN 已存在，不能重复创建。"
  }

  const maintainerError = validateMaintainerUuids(record.maintainerUuids, maintainers)
  if (maintainerError) return maintainerError

  if (
    !record.maintainerUuids.some((uuid) =>
      maintainers.some((maintainer) => maintainer.uuid === uuid && maintainer.canEdit)
    )
  ) {
    return "至少需要关联一位有编辑权限的维护者。"
  }

  return validateGeoCodes(record.countryCode, record.subdivisionCode)
}

export function validateAsnDeletion(
  asn: number,
  maintainers: Maintainer[],
  existingAsns: AsnRecord[],
  roas: RoaRecord[] = []
): string | null {
  const original = existingAsns.find((existing) => existing.asn === asn)
  if (!original) return "未找到该 ASN 记录，无法删除。"

  const canEdit = original.maintainerUuids.some((uuid) =>
    maintainers.some((maintainer) => maintainer.uuid === uuid && maintainer.canEdit)
  )
  if (!canEdit) return "您没有权限删除此 ASN。"
  if (roas.some((roa) => roa.asn === asn)) return "该 ASN 正被 ROA 引用，无法删除。"

  return null
}
