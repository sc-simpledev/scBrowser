import { createHash, createHmac } from 'node:crypto'
import { base32Decode, counterBytes, totpCounter, totpRemaining, truncateHmac, type TotpCode, type TotpConfig } from '@scbrowser/shared'

/** RFC 6238 time-based codes, the kind authenticator apps show. */
export function totpCode(config: TotpConfig, nowMs = Date.now()): TotpCode {
  const hmac = createHmac(config.algorithm.toLowerCase(), base32Decode(config.secret)).update(counterBytes(totpCounter(nowMs, config.period))).digest()
  return { code: truncateHmac(hmac, config.digits), period: config.period, remaining: totpRemaining(nowMs, config.period) }
}

export const LEAK_RANGE_URL = 'https://api.pwnedpasswords.com/range/'

/** The SHA-1 a leak check works from. Only its first 5 characters are ever sent. */
export const leakHash = (password: string) => createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()

/** Reads Have I Been Pwned's range answer into suffix and count. Padding rows have a count of 0. */
export function parseLeakRange(body: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of body.split(/\r?\n/)) {
    const [suffix, count] = line.trim().split(':')
    if (suffix && count && /^[0-9A-F]{35}$/i.test(suffix)) counts.set(suffix.toUpperCase(), Number(count) || 0)
  }
  return counts
}
