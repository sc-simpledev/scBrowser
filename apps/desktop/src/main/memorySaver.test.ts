import { describe, expect, it } from 'vitest'
import { isShortOfMemory } from './memorySaver'

describe('memory saver', () => {
  it('counts the computer as short below a tenth free or 700 MB', () => {
    expect(isShortOfMemory({ total: 16 * 1024 * 1024, free: 1024 * 1024 })).toBe(true)
    expect(isShortOfMemory({ total: 4 * 1024 * 1024, free: 600 * 1024 })).toBe(true)
    expect(isShortOfMemory({ total: 16 * 1024 * 1024, free: 6 * 1024 * 1024 })).toBe(false)
    expect(isShortOfMemory({ total: 0, free: 0 })).toBe(false)
  })
})
