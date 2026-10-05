import {
  getNetworkSnapshot,
  NetworkOperationError,
  performNetworkOperation,
} from "../../../lib/server/network-store.mjs"
import { isSameOriginMutation } from "../../../lib/server/request-origin.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status })
}

export async function GET() {
  try {
    return Response.json({ error: null, data: getNetworkSnapshot() }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    console.error("Network snapshot failed:", error)
    return errorResponse("网络数据暂时无法读取。", 500)
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return errorResponse("拒绝跨站请求。", 403)
  }

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return errorResponse("请求必须使用 application/json。", 415)
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > 1_000_000) return errorResponse("请求内容过大。", 413)

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return errorResponse("请求 JSON 格式无效。", 400)
  }

  try {
    return Response.json(performNetworkOperation(payload))
  } catch (error) {
    if (error instanceof NetworkOperationError) {
      return errorResponse(error.message, error.status)
    }
    console.error("Network mutation failed:", error)
    return errorResponse("网络数据暂时无法保存。", 500)
  }
}
