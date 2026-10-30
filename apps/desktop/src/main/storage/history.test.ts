import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from './database'
import { HistoryRepo } from './history'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

let history: HistoryRepo

beforeEach(() => {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  history = new HistoryRepo(db)
})

describe('HistoryRepo', () => {
  it('counts repeat visits and keeps the latest non-empty title', () => {
    history.recordVisit('https://example.com/', 'Example', NOW - DAY)
    history.recordVisit('https://example.com/', '', NOW)
    expect(history.search('example', 8, NOW)).toEqual([
      { url: 'https://example.com/', title: 'Example', visitCount: 2, lastVisit: NOW }
    ])
  })

  it('ignores internal and non-web URLs', () => {
    history.recordVisit('sc://newtab/')
    history.recordVisit('file:///etc/passwd')
    expect(history.search('e')).toEqual([])
  })

  it('matches titles as well as URLs', () => {
    history.recordVisit('https://news.ycombinator.com/', 'Hacker News', NOW)
    expect(history.search('hacker', 8, NOW).map((e) => e.url)).toEqual(['https://news.ycombinator.com/'])
  })

  it('ranks address-prefix matches first, then by frecency', () => {
    history.recordVisit('https://blog.dev/github-tips', 'Tips', NOW)
    for (let i = 0; i < 5; i++) history.recordVisit('https://docs.dev/about-github', 'Docs', NOW)
    history.recordVisit('https://www.github.com/', 'GitHub', NOW - 30 * DAY)
    expect(history.search('github', 8, NOW).map((e) => e.url)).toEqual([
      'https://www.github.com/',
      'https://docs.dev/about-github',
      'https://blog.dev/github-tips'
    ])
  })

  it('treats LIKE wildcards in the query literally', () => {
    history.recordVisit('https://a.dev/100%', 'Percent', NOW)
    history.recordVisit('https://b.dev/1000', 'Other', NOW)
    expect(history.search('100%', 8, NOW).map((e) => e.url)).toEqual(['https://a.dev/100%'])
  })
})
