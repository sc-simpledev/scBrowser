import { describe, expect, it } from 'vitest'
import { formatTimestamp, isCitationTarget, linkCitations, parseCitationHref, parseTimestamp, textFragmentUrl, videoTimeUrl } from './citations'

describe('citations', () => {
  it('links numbered citations, with or without a quote', () => {
    const text = linkCitations('Cats sleep a lot [1]. They purr [2: "a low hum"].', { sources: 2, timestamps: false })
    expect(text).toContain('[1](#sc-cite-1)')
    expect(text).toContain(`[2](#sc-cite-2~${encodeURIComponent('a low hum')})`)
  })

  it('splits a list of sources into one chip each', () => {
    expect(linkCitations('Both say so [1, 2].', { sources: 2, timestamps: false })).toBe('Both say so [1](#sc-cite-1)[2](#sc-cite-2).')
  })

  it('leaves numbers past the last source, links and code alone', () => {
    expect(linkCitations('See [3] and [a link](https://x.com) and `[1]`', { sources: 2, timestamps: false })).toBe('See [3] and [a link](https://x.com) and `[1]`')
    expect(linkCitations('```\nconst a = [1]\n```', { sources: 2, timestamps: false })).toBe('```\nconst a = [1]\n```')
  })

  it('links video times only when a transcript was read', () => {
    expect(linkCitations('At [1:23] and [1:02:03].', { sources: 1, timestamps: true })).toBe('At [1:23](#sc-time-83) and [1:02:03](#sc-time-3723).')
    expect(linkCitations('At [1:23].', { sources: 1, timestamps: false })).toBe('At [1:23].')
  })

  it('reads its own links back', () => {
    expect(parseCitationHref(`#sc-cite-2~${encodeURIComponent('a low hum')}`)).toEqual({ n: 2, target: { quote: 'a low hum', seconds: null } })
    expect(parseCitationHref('#sc-time-83')).toEqual({ n: 0, target: { quote: null, seconds: 83 } })
    expect(parseCitationHref('#sc-cite-x')).toBeNull()
    expect(parseCitationHref('#sc-cite-1~%E0%A4%A')).toEqual({ n: 1, target: { quote: null, seconds: null } })
    expect(parseCitationHref('https://example.com')).toBeNull()
  })

  it('reads and writes times', () => {
    expect(parseTimestamp('0:59')).toBe(59)
    expect(parseTimestamp('1:60')).toBeNull()
    expect(parseTimestamp('12')).toBeNull()
    expect(formatTimestamp(3723)).toBe('1:02:03')
    expect(formatTimestamp(83)).toBe('1:23')
  })

  it('checks targets from the interface', () => {
    expect(isCitationTarget({ quote: 'words', seconds: null })).toBe(true)
    expect(isCitationTarget({ quote: null, seconds: -1 })).toBe(false)
    expect(isCitationTarget({ quote: 'x'.repeat(500), seconds: null })).toBe(false)
  })

  it('builds addresses that find the spot when a tab has closed', () => {
    expect(textFragmentUrl('https://example.com/a#old', 'a low hum')).toBe('https://example.com/a#:~:text=a%20low%20hum')
    expect(videoTimeUrl('https://www.youtube.com/watch?v=abc', 83)).toBe('https://www.youtube.com/watch?v=abc&t=83s')
  })
})
