function parseExactOrigin(value) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.origin !== value
    ) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

function parseHostOrigin(protocol, host) {
  if (!host || /[\s/@?#\\,]/.test(host)) return null
  try {
    const parsed = new URL(`${protocol}//${host}`)
    if (
      parsed.protocol !== protocol ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

export function isSameOriginMutation(request, publicOrigin = process.env.PUBLIC_ORIGIN) {
  const origin = parseExactOrigin(request.headers.get("origin"))
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase()
  if (
    !origin ||
    (fetchSite && !["same-origin", "same-site", "cross-site", "none"].includes(fetchSite))
  ) {
    return false
  }
  if (fetchSite === "cross-site") return false

  let requestUrl
  try {
    requestUrl = new URL(request.url)
  } catch {
    return false
  }
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") return false

  const hostOrigin = parseHostOrigin(requestUrl.protocol, request.headers.get("host"))
  if (!hostOrigin) return false

  const configuredOrigin = typeof publicOrigin === "string" ? publicOrigin.trim() : ""
  // TLS-terminating deployments must configure PUBLIC_ORIGIN; forwarded headers are not trusted.
  const expectedOrigin = configuredOrigin === "" ? hostOrigin : parseExactOrigin(configuredOrigin)
  return expectedOrigin !== null && origin === expectedOrigin
}
