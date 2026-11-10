export interface Config {
  port: number
  /** How many proxies sit in front of us. 0 means use the connection's address. */
  trustedProxyHops: number
  requestsPerMinute: number
  requestsPerDay: number
  tokensPerDay: number
  /** Stops all free usage for the day, across every visitor, to cap what it can cost. */
  globalTokensPerDay: number
  concurrentPerIp: number
  maxBodyBytes: number
  maxInputChars: number
  maxOutputTokens: number
}

function number(env: (name: string) => string | undefined, name: string, fallback: number): number {
  const value = env(name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

export function loadConfig(env: (name: string) => string | undefined): Config {
  return {
    port: number(env, 'PORT', 8787),
    trustedProxyHops: number(env, 'TRUSTED_PROXY_HOPS', 0),
    requestsPerMinute: number(env, 'REQUESTS_PER_MINUTE', 10),
    requestsPerDay: number(env, 'REQUESTS_PER_DAY', 1200),
    tokensPerDay: number(env, 'TOKENS_PER_DAY', 2_400_000),
    globalTokensPerDay: number(env, 'GLOBAL_TOKENS_PER_DAY', 5_000_000),
    concurrentPerIp: number(env, 'CONCURRENT_PER_IP', 2),
    maxBodyBytes: number(env, 'MAX_BODY_BYTES', 1_000_000),
    maxInputChars: number(env, 'MAX_INPUT_CHARS', 300_000),
    maxOutputTokens: number(env, 'MAX_OUTPUT_TOKENS', 8_000)
  }
}
