import { session } from 'electron'

const ENDPOINT = 'https://duckduckgo.com/ac/?type=list&q='
const TIMEOUT_MS = 1500

let inFlight: AbortController | null = null

/**
 * Fetches search-engine completions for what's typed in the omnibox. Requests go through
 * an in-memory session so no cookies or cache from browsing are attached. Only the latest
 * query matters, so a new call cancels the previous one.
 */
export async function fetchSearchSuggestions(query: string): Promise<string[]> {
  inFlight?.abort()
  const trimmed = query.trim()
  if (!trimmed || trimmed.length > 200) return []

  const controller = new AbortController()
  inFlight = controller
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await session
      .fromPartition('scb-search-suggestions')
      .fetch(ENDPOINT + encodeURIComponent(trimmed), { signal: controller.signal })
    if (!response.ok) return []
    const body: unknown = await response.json()
    // Response shape: ["query", ["suggestion", ...]]
    const phrases = Array.isArray(body) ? body[1] : null
    return Array.isArray(phrases) ? phrases.filter((p): p is string => typeof p === 'string').slice(0, 8) : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
    if (inFlight === controller) inFlight = null
  }
}
