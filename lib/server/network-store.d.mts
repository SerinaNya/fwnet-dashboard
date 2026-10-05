import type { AsnRecord, Maintainer, RoaRecord } from "../network-data"

export type NetworkSnapshot = {
  maintainers: Maintainer[]
  asns: AsnRecord[]
  roas: RoaRecord[]
  isAdmin: false
}

export class NetworkOperationError extends Error {
  status: number
  constructor(message: string, status?: number)
}

export function getNetworkSnapshot(): NetworkSnapshot
export function performNetworkOperation(payload: unknown): {
  error: null
  data: NetworkSnapshot
}
export function importNetworkFile(sourcePath: string): {
  imported: boolean
  alreadyImported: boolean
}
