import { describe, expect, it } from 'vitest'
import { isPrintChoice, pagesIn, parsePageRanges } from './print'

describe('page ranges', () => {
  it('reads lists and ranges, and treats empty as every page', () => {
    expect(parsePageRanges('', 4)).toEqual([{ from: 1, to: 4 }])
    expect(parsePageRanges('1-2, 4', 4)).toEqual([{ from: 1, to: 2 }, { from: 4, to: 4 }])
    expect(pagesIn(parsePageRanges('3, 1-2, 2', 4)!)).toEqual([1, 2, 3])
  })

  it('refuses pages that are out of range or backwards', () => {
    expect(parsePageRanges('5', 4)).toBeNull()
    expect(parsePageRanges('3-1', 4)).toBeNull()
    expect(parsePageRanges('0', 4)).toBeNull()
    expect(parsePageRanges('a', 4)).toBeNull()
  })

  it('checks a choice from a page', () => {
    expect(isPrintChoice({ destination: 'pdf', pages: '', copies: 1, landscape: false, color: true, twoSided: false })).toBe(true)
    expect(isPrintChoice({ destination: 'pdf', pages: '', copies: 0, landscape: false, color: true, twoSided: false })).toBe(false)
  })
})
