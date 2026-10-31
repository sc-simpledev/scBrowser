import { describe, expect, it } from 'vitest'
import { MAX_SYNCED_HISTORY, mergeEntries, mergeSync, EMPTY_SYNC } from './sync'

describe('mergeEntries', () => {
  it('combines additions from both sides', () => {
    expect(mergeEntries({}, { a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
  })

  it('keeps a deletion from either side', () => {
    expect(mergeEntries({ a: 1, b: 2 }, { b: 2 }, { a: 1, b: 2 })).toEqual({ b: 2 })
    expect(mergeEntries({ a: 1, b: 2 }, { a: 1, b: 2 }, { b: 2 })).toEqual({ b: 2 })
  })

  it('takes the side that changed, and resolves when both did', () => {
    expect(mergeEntries({ a: 1 }, { a: 1 }, { a: 2 })).toEqual({ a: 2 })
    expect(mergeEntries({ a: 1 }, { a: 2 }, { a: 1 })).toEqual({ a: 2 })
    expect(mergeEntries({ a: 1 }, { a: 2 }, { a: 3 }, Math.max)).toEqual({ a: 3 })
  })

  it('keeps false and empty values', () => {
    expect(mergeEntries({}, { a: false, b: '' }, {})).toEqual({ a: false, b: '' })
  })

  it('is not confused by keys like __proto__', () => {
    expect(Object.keys(mergeEntries({}, JSON.parse('{"__proto__x":1,"constructor":2}'), {}))).toEqual(['__proto__x', 'constructor'])
  })
})

describe('mergeSync', () => {
  it('adds up history from both devices by the highest count and newest visit', () => {
    const merged = mergeSync(
      EMPTY_SYNC,
      { ...EMPTY_SYNC, history: { u: { title: 'Old', visitCount: 3, lastVisit: 10 } } },
      { ...EMPTY_SYNC, history: { u: { title: 'New', visitCount: 2, lastVisit: 20 } } }
    )
    expect(merged.history.u).toEqual({ title: 'New', visitCount: 3, lastVisit: 20 })
  })

  it('caps history by dropping the oldest', () => {
    const history = Object.fromEntries(Array.from({ length: MAX_SYNCED_HISTORY + 2 }, (_, i) => [`u${i}`, { title: '', visitCount: 1, lastVisit: i }]))
    const merged = mergeSync(EMPTY_SYNC, { ...EMPTY_SYNC, history }, EMPTY_SYNC)
    expect(Object.keys(merged.history)).toHaveLength(MAX_SYNCED_HISTORY)
    expect(merged.history.u0).toBeUndefined()
  })
})
