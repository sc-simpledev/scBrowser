import { describe, expect, it } from 'vitest'
import { acceptHunk, diffRanges, fileHunks, rejectHunk } from './diffHunks'

const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n')
const after = ['a', 'B', 'c', 'd', 'e', 'new', 'f', 'g'].join('\n')

describe('fileHunks', () => {
  it('splits separate changes apart', () => {
    const hunks = fileHunks(before, after)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]!.rows).toContain('- b')
    expect(hunks[0]!.rows).toContain('+ B')
    expect(hunks[1]!.rows).toContain('+ new')
    expect(hunks[0]!.id).not.toBe(hunks[1]!.id)
  })

  it('finds nothing in identical text', () => {
    expect(fileHunks(before, before)).toEqual([])
    expect(diffRanges([], [])).toEqual([])
  })

  it('keeps one change and leaves the other still to decide', () => {
    const [first] = fileHunks(before, after)
    const kept = acceptHunk(before, after, first!.range)
    const rest = fileHunks(kept, after)
    expect(rest).toHaveLength(1)
    expect(rest[0]!.rows).toContain('+ new')
  })

  it('puts one change back without touching the other', () => {
    const [first] = fileHunks(before, after)
    expect(rejectHunk(before, after, first!.range)).toBe(['a', 'b', 'c', 'd', 'e', 'new', 'f', 'g'].join('\n'))
  })

  it('reaches the same place deciding the last change first or the first', () => {
    const hunks = fileHunks(before, after)
    expect(rejectHunk(before, rejectHunk(before, after, hunks[1]!.range), hunks[0]!.range)).toBe(before)
  })

  it('treats a very large change as one piece', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `x${i}`)
    const other = Array.from({ length: 3000 }, (_, i) => `y${i}`)
    expect(diffRanges(big, other)).toHaveLength(1)
  })
})
