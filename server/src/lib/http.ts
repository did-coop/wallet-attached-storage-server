import Negotiator from "negotiator"

// convert DOM-style Headers to Node.js style headers
export function toNodeHeaders(headers: Headers) {
  const nodeHeaders: Record<string, string[] | string> = {}
  for (const [key, value] of headers.entries()) {
    const normalizedKey = key.toLowerCase()
    const prev = nodeHeaders[normalizedKey]
    nodeHeaders[normalizedKey] = Array.isArray(prev) ? [...prev, value] : prev ? [prev, value] : value
  }
  return nodeHeaders
}

export function negotiate(headers: Headers, supportedMediaTypes?: string[]) {
  const negotiator = new Negotiator({ headers: toNodeHeaders(headers) })
  return negotiator.mediaType(supportedMediaTypes)
}
