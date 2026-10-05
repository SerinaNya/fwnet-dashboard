function parseIpv4Bytes(address) {
  const parts = address.split(".")
  if (parts.length !== 4) return null
  const bytes = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) return -1
    return Number(part)
  })
  return bytes.some((byte) => byte < 0 || byte > 255) ? null : bytes
}

function parseIpv6Groups(address) {
  let normalizedAddress = address
  if (normalizedAddress.includes(".")) {
    const lastColon = normalizedAddress.lastIndexOf(":")
    if (lastColon < 0) return null
    const bytes = parseIpv4Bytes(normalizedAddress.slice(lastColon + 1))
    if (!bytes) return null
    const high = ((bytes[0] << 8) | bytes[1]).toString(16)
    const low = ((bytes[2] << 8) | bytes[3]).toString(16)
    normalizedAddress = `${normalizedAddress.slice(0, lastColon)}:${high}:${low}`
  }

  const compressionIndex = normalizedAddress.indexOf("::")
  if (compressionIndex !== -1 && normalizedAddress.lastIndexOf("::") !== compressionIndex) {
    return null
  }
  const parseGroups = (part) => {
    if (part === "") return []
    const groups = part.split(":")
    if (groups.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) return null
    return groups.map((group) => Number.parseInt(group, 16))
  }

  if (compressionIndex === -1) {
    const groups = parseGroups(normalizedAddress)
    return groups?.length === 8 ? groups : null
  }

  const left = parseGroups(normalizedAddress.slice(0, compressionIndex))
  const right = parseGroups(normalizedAddress.slice(compressionIndex + 2))
  if (!left || !right || left.length + right.length >= 8) return null
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
}

function formatIpv6(groups) {
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

  const formatted = groups.map((group) => group.toString(16))
  if (bestStart === -1) return formatted.join(":")
  const left = formatted.slice(0, bestStart).join(":")
  const right = formatted.slice(bestStart + bestLength).join(":")
  if (!left) return `::${right}`
  if (!right) return `${left}::`
  return `${left}::${right}`
}

function hasHostBits(bytes, prefixLength) {
  for (let bit = prefixLength; bit < bytes.length * 8; bit += 1) {
    if ((bytes[Math.floor(bit / 8)] & (1 << (7 - (bit % 8)))) !== 0) return true
  }
  return false
}

export function parseRouteCidr(route) {
  if (typeof route !== "string") return null
  const parts = route.trim().split("/")
  if (parts.length !== 2 || parts[0] === "" || !/^\d{1,3}$/.test(parts[1])) return null

  const isIpv6 = parts[0].includes(":")
  const addressBits = isIpv6 ? 128 : 32
  const groups = isIpv6 ? parseIpv6Groups(parts[0]) : null
  const bytes = isIpv6
    ? groups?.flatMap((group) => [group >> 8, group & 0xff]) ?? null
    : parseIpv4Bytes(parts[0])
  if (!bytes) return null

  const prefixLength = Number(parts[1])
  if (prefixLength > addressBits || hasHostBits(bytes, prefixLength)) return null
  const address = isIpv6
    ? formatIpv6(groups)
    : bytes.join(".")
  return { route: `${address}/${prefixLength}`, prefixLength, addressBits }
}
