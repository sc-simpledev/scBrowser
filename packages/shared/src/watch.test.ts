import { describe, expect, it } from 'vitest'
import { diffWatchText, intervalLabel, normaliseWatchText } from './watch'

describe('watched pages', () => {
  it('ignores spacing and blank lines', () => {
    expect(normaliseWatchText('  Price:   $10 \n\n\t In stock  \r\n')).toBe('Price: $10\nIn stock')
  })

  it('reports lines that came and went', () => {
    expect(diffWatchText('Price: $10\nIn stock', 'Price: $8\nIn stock')).toEqual({ added: ['Price: $8'], removed: ['Price: $10'] })
  })

  it('ignores reordering', () => {
    expect(diffWatchText('a\nb\nc', 'c\na\nb')).toEqual({ added: [], removed: [] })
  })

  it('counts repeated lines', () => {
    expect(diffWatchText('Sold out\nSold out', 'Sold out')).toEqual({ added: [], removed: ['Sold out'] })
  })

  it('handles empty text on either side', () => {
    expect(diffWatchText('', 'New')).toEqual({ added: ['New'], removed: [] })
    expect(diffWatchText('Old', '')).toEqual({ added: [], removed: ['Old'] })
  })

  it('names intervals', () => {
    expect([15, 60, 360, 1440].map((m) => intervalLabel(m as 15))).toEqual(['Every 15 minutes', 'Every hour', 'Every 6 hours', 'Every day'])
  })
})
