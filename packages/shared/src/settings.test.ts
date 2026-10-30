import { describe, expect, it } from 'vitest'
import { engineById, sanitizeSettings } from './settings'

describe('sanitizeSettings', () => {
  it('keeps valid values', () => {
    expect(sanitizeSettings({ theme: 'dark', sleepAfterMinutes: 5 })).toEqual({ theme: 'dark', sleepAfterMinutes: 5 })
  })

  it('drops unknown keys, bad values and non-objects', () => {
    expect(sanitizeSettings({ theme: 'neon', sleepAfterMinutes: -1, searchEngine: 'x', evil: true })).toEqual({})
    expect(sanitizeSettings({ toString: 'x', constructor: 1 })).toEqual({})
    expect(sanitizeSettings(null)).toEqual({})
  })
})

describe('engineById', () => {
  it('falls back to the default engine', () => {
    expect(engineById('nope').id).toBe('duckduckgo')
    expect(engineById('google').name).toBe('Google')
  })
})
