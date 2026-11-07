import { describe, expect, it } from 'vitest'
import { base32Decode, counterBytes, formatTotp, isTotpConfig, parseTotp, totpRemaining, totpUri, truncateHmac } from './totp'

/** RFC 6238's SHA-1 key, "12345678901234567890", in base32. */
const RFC_KEY = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('two-step codes', () => {
  it('truncates as RFC 4226 shows', () => {
    // RFC 4226's worked example: the HMAC whose truncation gives 872921.
    const hmac = Uint8Array.from([0x1f, 0x86, 0x98, 0x69, 0x0e, 0x02, 0xca, 0x16, 0x61, 0x85, 0x50, 0xef, 0x7f, 0x19, 0xda, 0x8e, 0x94, 0x5b, 0x55, 0x5a])
    expect(truncateHmac(hmac, 6)).toBe('872921')
    expect([...counterBytes(1)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect([...counterBytes(2 ** 33)]).toEqual([0, 0, 0, 2, 0, 0, 0, 0])
  })

  it('decodes base32 the way RFC 4648 does', () => {
    expect(new TextDecoder().decode(base32Decode(RFC_KEY))).toBe('12345678901234567890')
    expect(new TextDecoder().decode(base32Decode('MZXW6YTBOI'))).toBe('foobar')
  })

  it('takes keys as sites show them, with spaces, dashes, lower case and padding', () => {
    expect(parseTotp('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq==')).toEqual({ secret: RFC_KEY, digits: 6, period: 30, algorithm: 'SHA1' })
  })

  it('reads otpauth addresses from QR codes, with their options', () => {
    expect(parseTotp(`otpauth://totp/Example:sam?secret=${RFC_KEY}&issuer=Example&digits=8&period=60&algorithm=sha256`)).toEqual({ secret: RFC_KEY, digits: 8, period: 60, algorithm: 'SHA256' })
  })

  it('refuses what it can’t use', () => {
    expect(parseTotp('')).toBeNull()
    expect(parseTotp('not a key!')).toBeNull()
    expect(parseTotp('ABCDEFGH')).toBeNull() // too short to be a real key
    expect(parseTotp(`otpauth://hotp/x?secret=${RFC_KEY}&counter=1`)).toBeNull()
    expect(parseTotp(`otpauth://totp/x?secret=${RFC_KEY}&digits=5`)).toBeNull()
    expect(parseTotp(`otpauth://totp/x?secret=${RFC_KEY}&algorithm=MD5`)).toBeNull()
    expect(parseTotp('otpauth://totp/x')).toBeNull()
  })

  it('writes an address that reads back the same', () => {
    const config = parseTotp(RFC_KEY)!
    expect(parseTotp(totpUri(config, 'example.com:sam'))).toEqual(config)
    expect(isTotpConfig(config)).toBe(true)
    expect(isTotpConfig({ ...config, secret: 'bad key' })).toBe(false)
  })

  it('counts down to the next code', () => {
    expect(totpRemaining(0, 30)).toBe(30)
    expect(totpRemaining(29_500, 30)).toBe(1)
    expect(totpRemaining(30_000, 30)).toBe(30)
  })

  it('splits codes in two for reading', () => {
    expect(formatTotp('123456')).toBe('123 456')
    expect(formatTotp('12345678')).toBe('1234 5678')
    expect(formatTotp('1234567')).toBe('1234567')
  })
})
