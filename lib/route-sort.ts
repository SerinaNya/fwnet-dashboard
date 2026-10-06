import { parseRouteCidr } from "./server/route-cidr.mjs"

type ParsedCidr = {
  route: string
  prefixLength: number
  addressBits: number
}

function addressNumber(parsed: ParsedCidr) {
  const address = parsed.route.slice(0, parsed.route.lastIndexOf("/"))
  if (parsed.addressBits === 32) {
    return address
      .split(".")
      .reduce((value, part) => value * BigInt(256) + BigInt(part), BigInt(0))
  }

  const compressionIndex = address.indexOf("::")
  const groups = compressionIndex === -1
    ? address.split(":")
    : [
        ...(address.slice(0, compressionIndex) ? address.slice(0, compressionIndex).split(":") : []),
        ...Array(8 - address.slice(0, compressionIndex).split(":").filter(Boolean).length - address.slice(compressionIndex + 2).split(":").filter(Boolean).length).fill("0"),
        ...(address.slice(compressionIndex + 2) ? address.slice(compressionIndex + 2).split(":") : []),
      ]

  return groups.reduce(
    (value, group) => value * BigInt(65536) + BigInt(Number.parseInt(group, 16)),
    BigInt(0)
  )
}

function compareNatural(left: string, right: string) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" })
}

export function compareRouteCidrs(left: string, right: string) {
  const parsedLeft = parseRouteCidr(left) as ParsedCidr | null
  const parsedRight = parseRouteCidr(right) as ParsedCidr | null

  if (!parsedLeft || !parsedRight) return compareNatural(left, right)
  if (parsedLeft.addressBits !== parsedRight.addressBits) {
    return parsedLeft.addressBits - parsedRight.addressBits
  }

  const leftAddress = addressNumber(parsedLeft)
  const rightAddress = addressNumber(parsedRight)
  if (leftAddress < rightAddress) return -1
  if (leftAddress > rightAddress) return 1
  return parsedLeft.prefixLength - parsedRight.prefixLength
}
