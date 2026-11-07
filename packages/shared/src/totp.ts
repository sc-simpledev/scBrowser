/** How a site's authenticator codes are made, from the key or QR code it shows when two-step sign-in is turned on. */
export interface TotpConfig {
  /** Base32, upper case, no spaces or padding. */
  secret: string
  digits: 6 | 7 | 8
  /** Seconds each code lasts. */
  period: number
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Upper case without spaces, dashes or padding, or null if it isn't base32. */
function cleanSecret(text: string): string | null {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  // 80 bits is the least RFC 4226 allows, and sites use 80 to 160.
  return clean.length >= 16 && clean.length <= 256 && [...clean].every((char) => BASE32.includes(char)) ? clean : null
}

export function base32Decode(secret: string): Uint8Array {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of secret) {
    const value = BASE32.indexOf(char)
    if (value < 0) throw new Error('Not base32')
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return Uint8Array.from(bytes)
}

/** Takes a setup key as sites show it, or an `otpauth://totp/` address from a QR code. Null if it's neither. */
export function parseTotp(input: string): TotpConfig | null {
  const text = input.trim()
  if (!/^otpauth:/i.test(text)) {
    const secret = cleanSecret(text)
    return secret ? { secret, digits: 6, period: 30, algorithm: 'SHA1' } : null
  }
  if (!URL.canParse(text)) return null
  const url = new URL(text)
  // HOTP counts sign-ins instead of time, which would need saving after every use.
  if (url.host.toLowerCase() !== 'totp') return null
  const secret = cleanSecret(url.searchParams.get('secret') ?? '')
  const digits = Number(url.searchParams.get('digits') ?? 6)
  const period = Number(url.searchParams.get('period') ?? 30)
  const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
  if (!secret || (digits !== 6 && digits !== 7 && digits !== 8)) return null
  if (!Number.isInteger(period) || period < 10 || period > 300) return null
  if (algorithm !== 'SHA1' && algorithm !== 'SHA256' && algorithm !== 'SHA512') return null
  return { secret, digits, period, algorithm }
}

/** The address an authenticator app would take, for exporting. */
export function totpUri(config: TotpConfig, label: string): string {
  const params = new URLSearchParams({ secret: config.secret, digits: String(config.digits), period: String(config.period), algorithm: config.algorithm })
  return `otpauth://totp/${encodeURIComponent(label)}?${params}`
}

export const isTotpConfig = (value: unknown): value is TotpConfig => {
  if (typeof value !== 'object' || value === null) return false
  const { secret, digits, period, algorithm } = value as Record<string, unknown>
  return typeof secret === 'string' && cleanSecret(secret) === secret && (digits === 6 || digits === 7 || digits === 8) && typeof period === 'number' && ['SHA1', 'SHA256', 'SHA512'].includes(algorithm as string)
}

/** Which step of `period` seconds a moment falls in. */
export const totpCounter = (nowMs: number, period: number) => Math.floor(nowMs / 1000 / period)

/** Seconds until the next code. */
export const totpRemaining = (nowMs: number, period: number) => period - (Math.floor(nowMs / 1000) % period)

/** RFC 4226's dynamic truncation, from an HMAC already worked out. */
export function truncateHmac(hmac: Uint8Array, digits: number): string {
  const offset = hmac[hmac.length - 1]! & 0x0f
  const value = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!
  return String(value % 10 ** digits).padStart(digits, '0')
}

/** The 8-byte big-endian counter HOTP signs. */
export function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8)
  let rest = counter
  for (let i = 7; i >= 0; i--) {
    bytes[i] = rest % 256
    rest = Math.floor(rest / 256)
  }
  return bytes
}

/** Codes are easier to read in two halves, like 123 456. */
export const formatTotp = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code)
