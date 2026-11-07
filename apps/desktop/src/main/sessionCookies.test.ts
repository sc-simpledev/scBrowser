import { describe, expect, it } from 'vitest'
import { persistent } from './sessionCookies'

const base = { name: 'sid', value: 'abc', path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax' as const }

describe('persistent', () => {
  it('keeps a host-only cookie on its own host', () => {
    const details = persistent({ ...base, domain: 'accounts.example.com', hostOnly: true }, 1_000_000)!
    expect(details.url).toBe('https://accounts.example.com/')
    expect(details).not.toHaveProperty('domain')
    expect(details.expirationDate).toBe(1000 + 30 * 86_400)
    expect(details.sameSite).toBe('lax')
  })

  it('keeps a domain cookie for the whole domain', () => {
    const details = persistent({ ...base, domain: '.example.com', hostOnly: false, secure: false, sameSite: 'unspecified' })!
    expect(details.url).toBe('http://example.com/')
    expect(details.domain).toBe('.example.com')
    expect(details).not.toHaveProperty('sameSite')
  })

  it('skips a cookie without a domain', () => {
    expect(persistent({ ...base, domain: '' })).toBeNull()
  })
})
