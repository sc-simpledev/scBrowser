import { describe, expect, it, vi } from 'vitest'
import { isGoogleSignIn, withChromeBrand } from './googleSignIn'

vi.mock('electron', () => ({ app: {} }))

describe('Google sign-in', () => {
  it('only matches the sign-in hosts themselves', () => {
    expect(isGoogleSignIn('https://accounts.google.com/signin')).toBe(true)
    expect(isGoogleSignIn('https://accounts.youtube.com/accounts/CheckConnection')).toBe(true)
    for (const url of ['https://google.com/', 'https://mail.google.com/', 'https://accounts.google.com.evil.test/', 'not a url']) expect(isGoogleSignIn(url)).toBe(false)
  })
})

describe('Chrome Web Store brands', () => {
  it('replaces the client hint brands, whatever case they came in', () => {
    const headers = withChromeBrand({ 'Sec-CH-UA': '"Chromium";v="140"', Accept: '*/*' })
    expect(headers).not.toHaveProperty('Sec-CH-UA')
    expect(headers['sec-ch-ua']).toContain('"Google Chrome"')
    expect(headers.Accept).toBe('*/*')
  })
})
