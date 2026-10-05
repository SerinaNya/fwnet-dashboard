"use client"

import * as React from "react"

import type { AsnRecord, Maintainer, RoaRecord } from "@/lib/network-data"

type NetworkSnapshot = {
  maintainers: Maintainer[]
  asns: AsnRecord[]
  roas: RoaRecord[]
  isAdmin: boolean
}

type NetworkDataContextValue = NetworkSnapshot & {
  loading: boolean
  loadError: string | null
  retry: () => void
  saveMaintainer: (record: Maintainer) => Promise<string | null>
  createAsn: (record: AsnRecord) => Promise<string | null>
  saveAsn: (record: AsnRecord) => Promise<string | null>
  deleteAsn: (asn: number) => Promise<string | null>
  createRoa: (record: RoaRecord) => Promise<string | null>
  saveRoa: (record: RoaRecord) => Promise<string | null>
  deleteRoa: (uuid: string) => Promise<string | null>
}

type ApiResponse = {
  error: string | null
  data?: NetworkSnapshot
}

type MutationOperation =
  | "saveMaintainer"
  | "createAsn"
  | "saveAsn"
  | "deleteAsn"
  | "createRoa"
  | "saveRoa"
  | "deleteRoa"

type MutationPayload = {
  record?: Maintainer | AsnRecord | RoaRecord
  asn?: number
  uuid?: string
}

const NetworkDataContext = React.createContext<NetworkDataContextValue | null>(null)
const requestError = "网络请求失败，请稍后重试。"
const responseError = "服务器响应异常，请稍后重试。"

function toUserError(error: unknown) {
  if (error instanceof TypeError) return requestError
  return error instanceof Error ? error.message : responseError
}

async function readResponse(response: Response): Promise<ApiResponse | null> {
  try {
    return (await response.json()) as ApiResponse
  } catch {
    return null
  }
}

async function fetchSnapshot(signal: AbortSignal): Promise<NetworkSnapshot> {
  const response = await fetch("/api/network", { cache: "no-store", signal })
  const result = await readResponse(response)
  if (!response.ok) throw new Error(result?.error || responseError)
  if (!result) throw new Error(responseError)
  if (result.error) throw new Error(result.error)
  if (!result.data) throw new Error(responseError)
  return result.data
}

export function NetworkDataProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = React.useState<NetworkSnapshot | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const queue = React.useRef<Promise<void>>(Promise.resolve())
  const mounted = React.useRef(false)
  const loadControllers = React.useRef(new Set<AbortController>())

  const enqueue = React.useCallback(<T,>(task: () => Promise<T>) => {
    const result = queue.current.then(task, task)
    queue.current = result.then(() => undefined, () => undefined)
    return result
  }, [])

  const startLoad = React.useCallback((controller: AbortController) => {
    loadControllers.current.add(controller)
    void enqueue(async () => {
      if (controller.signal.aborted) return
      const nextSnapshot = await fetchSnapshot(controller.signal)
      if (controller.signal.aborted || !mounted.current) return
      setSnapshot(nextSnapshot)
      setLoadError(null)
      setLoading(false)
    }).catch((error: unknown) => {
      if (controller.signal.aborted || !mounted.current) return
      setLoadError(toUserError(error))
      setLoading(false)
    }).finally(() => {
      loadControllers.current.delete(controller)
    })
  }, [enqueue])

  React.useEffect(() => {
    mounted.current = true
    const controllers = loadControllers.current
    const controller = new AbortController()
    startLoad(controller)
    return () => {
      mounted.current = false
      for (const pending of controllers) pending.abort()
      controllers.clear()
    }
  }, [startLoad])

  const retry = React.useCallback(() => {
    if (!mounted.current) return
    setLoading(true)
    setLoadError(null)
    startLoad(new AbortController())
  }, [startLoad])

  const sendMutation = React.useCallback(
    (operation: MutationOperation, payload: MutationPayload): Promise<string | null> =>
      enqueue(async () => {
        try {
          const response = await fetch("/api/network", {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operation, ...payload }),
          })
          const result = await readResponse(response)
          if (!response.ok) return result?.error || responseError
          if (!result) return responseError
          if (result.error) return result.error
          if (!result.data) return responseError

          if (mounted.current) {
            setSnapshot(result.data)
            setLoadError(null)
          }
          return null
        } catch {
          return requestError
        }
      }),
    [enqueue]
  )

  const value = React.useMemo<NetworkDataContextValue>(
    () => ({
      maintainers: snapshot?.maintainers ?? [],
      asns: snapshot?.asns ?? [],
      roas: snapshot?.roas ?? [],
      isAdmin: snapshot?.isAdmin ?? false,
      loading,
      loadError,
      retry,
      saveMaintainer: (record) => sendMutation("saveMaintainer", { record }),
      createAsn: (record) => sendMutation("createAsn", { record }),
      saveAsn: (record) => sendMutation("saveAsn", { record }),
      deleteAsn: (asn) => sendMutation("deleteAsn", { asn }),
      createRoa: (record) => sendMutation("createRoa", { record }),
      saveRoa: (record) => sendMutation("saveRoa", { record }),
      deleteRoa: (uuid) => sendMutation("deleteRoa", { uuid }),
    }),
    [loadError, loading, retry, sendMutation, snapshot]
  )

  return (
    <NetworkDataContext.Provider value={value}>
      {children}
    </NetworkDataContext.Provider>
  )
}

export function useNetworkData() {
  const context = React.useContext(NetworkDataContext)
  if (!context) {
    throw new Error("useNetworkData 必须在 NetworkDataProvider 内使用。")
  }
  return context
}
