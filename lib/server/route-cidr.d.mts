export type ParsedRouteCidr = {
  route: string
  prefixLength: number
  addressBits: number
}

export function parseRouteCidr(route: string): ParsedRouteCidr | null
