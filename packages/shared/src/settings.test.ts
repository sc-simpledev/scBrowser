import { parseGoogleTranslation } from './ai'
import { describe, expect, it } from 'vitest'
import { estimateCost } from './ai'
import { engineById, sanitizeSettings, sleepMinutes } from './settings'

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

describe('sleepMinutes', () => {
  it('follows the setting until Performance Mode is on', () => {
    expect(sleepMinutes({ performanceMode: false, sleepAfterMinutes: 30 })).toBe(30)
    expect(sleepMinutes({ performanceMode: false, sleepAfterMinutes: 0 })).toBe(0)
  })

  it('only ever makes tabs sleep sooner in Performance Mode', () => {
    expect(sleepMinutes({ performanceMode: true, sleepAfterMinutes: 30 })).toBe(5)
    expect(sleepMinutes({ performanceMode: true, sleepAfterMinutes: 0 })).toBe(5)
    expect(sleepMinutes({ performanceMode: true, sleepAfterMinutes: 2 })).toBe(2)
  })
})

describe('estimateCost', () => {
  it('prices known models and applies the long-prompt rate', () => {
    expect(estimateCost('claude-opus-5-5', 1_000_000, 1_000_000)).toBe(24)
    expect(estimateCost('claude-haiku-5-5', 1_000, 0)).toBeCloseTo(0.0001)
    expect(estimateCost('claude-haiku-5-5', 200_000, 0)).toBeCloseTo(0.1)
  })

  it('returns null rather than guessing', () => {
    expect(estimateCost('some-local-model', 10, 10)).toBeNull()
  })
})

describe('engineById', () => {
  it('falls back to the default engine', () => {
    expect(engineById('nope').id).toBe('google')
    expect(engineById('google').name).toBe('Google')
  })
})

describe('parseGoogleTranslation', () => {
  it('reads either shape of answer, and refuses anything off', () => {
    expect(parseGoogleTranslation([['Hola', 'en'], ['Adiós', 'en']], 2)).toEqual(['Hola', 'Adiós'])
    expect(parseGoogleTranslation(['Hola'], 1)).toEqual(['Hola'])
    expect(parseGoogleTranslation([['Hola', 'en']], 2)).toBeNull()
    expect(parseGoogleTranslation([[1, 'en']], 1)).toBeNull()
    expect(parseGoogleTranslation({ error: 'no' }, 1)).toBeNull()
  })
})
