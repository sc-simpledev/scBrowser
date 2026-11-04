import { describe, expect, it, vi } from 'vitest'
import { firefoxUserAgent, isGoogleSignIn } from './googleSignIn'

vi.mock('electron', () => ({ app: {} }))

describe('Google sign-in', () => {
  it('only matches the sign-in host itself', () => {
    expect(isGoogleSignIn('https://accounts.google.com/signin')).toBe(true)
    for (const url of ['https://google.com/', 'https://mail.google.com/', 'https://accounts.google.com.evil.test/', 'not a url']) expect(isGoogleSignIn(url)).toBe(false)
  })

  it('names a current Firefox for the platform', () => {
    expect(firefoxUserAgent('linux', Date.UTC(2025, 5, 24))).toBe('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')
    expect(firefoxUserAgent('win32', Date.UTC(2025, 6, 22))).toContain('Windows NT 10.0; Win64; x64; rv:141.0')
    expect(firefoxUserAgent('darwin', Date.UTC(2026, 10, 5))).toContain('Macintosh')
  })
})
