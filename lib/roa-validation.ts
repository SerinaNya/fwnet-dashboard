import {
  validateGeoCodes,
  type AsnRecord,
  type Maintainer,
  type RoaRecord,
} from "@/lib/network-data"

export type ParsedRouteCidr = {
  route: string
  prefixLength: number
  addressBits: number
}

type RouteParseResult =
  | { parsed: ParsedRouteCidr }
  | { error: string }

function parseIpv4Bytes(address: string): number[] | null {
  const parts = address.split(".")
  if (parts.length !== 4) return null

  const bytes = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) {
      return -1
    }
    return Number(part)
  })
  if (bytes.some((byte) => byte < 0 || byte > 255)) return null
  return bytes
}

function parseIpv6Groups(address: string): number[] | null {
  let normalizedAddress = address

  if (normalizedAddress.includes(".")) {
    const lastColon = normalizedAddress.lastIndexOf(":")
    if (lastColon < 0) return null
    const ipv4Bytes = parseIpv4Bytes(normalizedAddress.slice(lastColon + 1))
    if (!ipv4Bytes) return null
    const high = ((ipv4Bytes[0] << 8) | ipv4Bytes[1]).toString(16)
    const low = ((ipv4Bytes[2] << 8) | ipv4Bytes[3]).toString(16)
    normalizedAddress = `${normalizedAddress.slice(0, lastColon)}:${high}:${low}`
  }

  const compressionIndex = normalizedAddress.indexOf("::")
  if (
    compressionIndex !== -1 &&
    normalizedAddress.lastIndexOf("::") !== compressionIndex
  ) {
    return null
  }

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return []
    const groups = part.split(":")
    if (groups.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) return null
    return groups.map((group) => Number.parseInt(group, 16))
  }

  let groups: number[]
  if (compressionIndex === -1) {
    const parsed = parseGroups(normalizedAddress)
    if (!parsed || parsed.length !== 8) return null
    groups = parsed
  } else {
    const left = parseGroups(normalizedAddress.slice(0, compressionIndex))
    const right = parseGroups(normalizedAddress.slice(compressionIndex + 2))
    if (!left || !right || left.length + right.length >= 8) return null
    groups = [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
  }

  return groups
}

function formatIpv6Address(groups: number[]): string {
  let bestStart = -1
  let bestLength = 1

  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1
      continue
    }
    let end = index
    while (end < groups.length && groups[end] === 0) end += 1
    if (end - index > bestLength) {
      bestStart = index
      bestLength = end - index
    }
    index = end
  }

  const formattedGroups = groups.map((group) => group.toString(16))
  if (bestStart === -1) return formattedGroups.join(":")

  const left = formattedGroups.slice(0, bestStart).join(":")
  const right = formattedGroups.slice(bestStart + bestLength).join(":")
  if (left === "") return `::${right}`
  if (right === "") return `${left}::`
  return `${left}::${right}`
}

function hasHostBits(bytes: number[], prefixLength: number): boolean {
  for (let bit = prefixLength; bit < bytes.length * 8; bit += 1) {
    const byte = bytes[Math.floor(bit / 8)]
    if ((byte & (1 << (7 - (bit % 8)))) !== 0) return true
  }
  return false
}

function parseRouteCidrWithError(route: string): RouteParseResult {
  if (typeof route !== "string") {
    return { error: "请输入有效的 IPv4 或 IPv6 CIDR。" }
  }

  const parts = route.trim().split("/")
  if (parts.length !== 2 || parts[0] === "") {
    return { error: "请输入有效的 IPv4 或 IPv6 CIDR，例如 192.0.2.0/24。" }
  }

  const address = parts[0]
  const isIpv6 = address.includes(":")
  const addressBits = isIpv6 ? 128 : 32
  const bytes = isIpv6
    ? parseIpv6Groups(address)?.flatMap((group) => [group >> 8, group & 0xff]) ?? null
    : parseIpv4Bytes(address)
  if (!bytes) return { error: "CIDR 中的 IP 地址格式无效。" }

  if (!/^\d{1,3}$/.test(parts[1])) {
    return { error: "CIDR 前缀长度必须是数字。" }
  }
  const prefixLength = Number(parts[1])
  if (prefixLength > addressBits) {
    return {
      error: `IPv${isIpv6 ? "6" : "4"} 前缀长度必须在 0 到 ${addressBits} 之间。`,
    }
  }

  if (hasHostBits(bytes, prefixLength)) {
    return { error: "CIDR 地址包含主机位，请输入主机位全为 0 的网络地址。" }
  }

  const normalizedAddress = isIpv6
    ? formatIpv6Address(
        Array.from({ length: 8 }, (_, index) => (bytes[index * 2] << 8) | bytes[index * 2 + 1])
      )
    : bytes.join(".")

  return {
    parsed: {
      route: `${normalizedAddress}/${prefixLength}`,
      prefixLength,
      addressBits,
    },
  }
}

export function parseRouteCidr(route: string): ParsedRouteCidr | null {
  const result = parseRouteCidrWithError(route)
  return "parsed" in result ? result.parsed : null
}

function validateRoaRoute(record: RoaRecord): { route: ParsedRouteCidr } | { error: string } {
  const result = parseRouteCidrWithError(record.route)
  if ("error" in result) return result

  if (
    !Number.isInteger(record.maxLength) ||
    record.maxLength < result.parsed.prefixLength ||
    record.maxLength > result.parsed.addressBits
  ) {
    return {
      error: `maxLength 必须是 ${result.parsed.prefixLength} 到 ${result.parsed.addressBits} 之间的整数。`,
    }
  }

  const geoError = validateGeoCodes(record.countryCode, record.subdivisionCode)
  if (geoError) return { error: geoError }
  return { route: result.parsed }
}

function validateRoaUuid(
  uuid: string,
  roas: RoaRecord[],
  excludedUuid?: string
): string | null {
  if (typeof uuid !== "string" || uuid.trim() === "") return "ROA UUID 不能为空。"
  if (roas.some((roa) => roa.uuid !== excludedUuid && roa.uuid === uuid)) {
    return "ROA UUID 已存在。"
  }
  return null
}

function validateAsnPermission(
  asn: number | null,
  maintainers: Maintainer[],
  asns: AsnRecord[]
): string | null {
  if (asn === null) return "未关联 ASN 的 ROA 仅管理员可以操作。"
  const asnRecord = asns.find((record) => record.asn === asn)
  if (!asnRecord) return "关联的 ASN 不存在。"

  if (
    !asnRecord.maintainerUuids.some((uuid) =>
      maintainers.some((maintainer) => maintainer.uuid === uuid && maintainer.canEdit)
    )
  ) {
    return "没有权限修改关联的 ASN。"
  }
  return null
}

function hasDuplicateTuple(
  route: string,
  maxLength: number,
  asn: number | null,
  roas: RoaRecord[],
  excludedUuid?: string
): boolean {
  return roas.some((roa) => {
    if (roa.uuid === excludedUuid || roa.maxLength !== maxLength || roa.asn !== asn) {
      return false
    }
    return (parseRouteCidr(roa.route)?.route ?? roa.route) === route
  })
}

export function validateNewRoaRecord(
  record: RoaRecord,
  maintainers: Maintainer[],
  asns: AsnRecord[],
  roas: RoaRecord[]
): string | null {
  const uuidError = validateRoaUuid(record.uuid, roas)
  if (uuidError) return uuidError

  const routeResult = validateRoaRoute(record)
  if ("error" in routeResult) return routeResult.error

  const asnError = validateAsnPermission(record.asn, maintainers, asns)
  if (asnError) return asnError

  if (hasDuplicateTuple(routeResult.route.route, record.maxLength, record.asn, roas)) {
    return "相同的路由、最大前缀长度和 ASN 已存在。"
  }
  return null
}

export function validateRoaRecord(
  record: RoaRecord,
  maintainers: Maintainer[],
  asns: AsnRecord[],
  roas: RoaRecord[]
): string | null {
  const original = roas.find((roa) => roa.uuid === record.uuid)
  if (!original) return "未找到该 ROA 记录，无法编辑。"

  const originalAsnError = validateAsnPermission(original.asn, maintainers, asns)
  if (originalAsnError) return "没有权限编辑原 ROA 关联的 ASN。"

  const targetAsnError = validateAsnPermission(record.asn, maintainers, asns)
  if (targetAsnError) return targetAsnError

  const routeResult = validateRoaRoute(record)
  if ("error" in routeResult) return routeResult.error

  const uuidError = validateRoaUuid(record.uuid, roas, original.uuid)
  if (uuidError) return uuidError

  if (
    hasDuplicateTuple(
      routeResult.route.route,
      record.maxLength,
      record.asn,
      roas,
      record.uuid
    )
  ) {
    return "相同的路由、最大前缀长度和 ASN 已存在。"
  }
  return null
}

export function validateRoaDeletion(
  uuid: string,
  maintainers: Maintainer[],
  asns: AsnRecord[],
  roas: RoaRecord[]
): string | null {
  const original = roas.find((roa) => roa.uuid === uuid)
  if (!original) return "未找到该 ROA 记录，无法删除。"

  const asnError = validateAsnPermission(original.asn, maintainers, asns)
  if (asnError) return "没有权限删除原 ROA 关联的 ASN。"
  return null
}
