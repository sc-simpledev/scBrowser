import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { calendarDaysBetween, localDayBefore, nowPlayingTab, PAUSED_SHOWN_MS } from '@scbrowser/shared'

vi.mock('electron', () => ({ session: { defaultSession: { fetch: () => Promise.reject(new Error('not in tests')) } } }))

import { checkLinks } from './linkCheck'
import { ReadingList, sameReadingPage } from './readingList'
import { BookmarksRepo } from './storage/bookmarks'
import { migrate } from './storage/database'
import { KeyValueRepo } from './storage/kv'

function db() {
  const database = new DatabaseSync(':memory:')
  migrate(database)
  return database
}

describe('bookmark link check', () => {
  const unresolved = async () => {
    throw new TypeError('fetch failed', { cause: new Error('net::ERR_NAME_NOT_RESOLVED') })
  }

  it('calls nothing dead when no site answered at all, as when offline', async () => {
    const results = await checkLinks(['https://a.example/', 'https://b.example/', 'https://c.example/'], unresolved)
    expect(results.map((result) => result.state)).toEqual(['unknown', 'unknown', 'unknown'])
  })

  it('still calls a vanished site dead when others answer', async () => {
    const results = await checkLinks(['https://ok.example/', 'https://gone.example/'], async (url) => (url.includes('gone') ? unresolved() : new Response(null, { status: 200 })))
    expect(Object.fromEntries(results.map((result) => [result.url, result.state]))).toEqual({ 'https://ok.example/': 'ok', 'https://gone.example/': 'dead' })
  })

  it('leaves a refused connection alone: the server may just be down', async () => {
    const results = await checkLinks(['https://ok.example/', 'https://down.example/'], async (url) => {
      if (url.includes('down')) throw new TypeError('fetch failed', { cause: new Error('net::ERR_CONNECTION_REFUSED') })
      return new Response(null, { status: 200 })
    })
    expect(results.find((result) => result.url.includes('down'))?.state).toBe('unknown')
  })
})

describe('reading list pages', () => {
  it('tells pages apart by their query, and ignores fragments, trailing slashes and tracking tags', () => {
    expect(sameReadingPage('https://news.example/story.php?id=1', 'https://news.example/story.php?id=2')).toBe(false)
    expect(sameReadingPage('https://news.example/story/', 'https://news.example/story#comments')).toBe(true)
    expect(sameReadingPage('https://news.example/story?utm_source=mail', 'https://news.example/story')).toBe(true)
  })

  it('keeps two pages on one site apart when saving and marking them read', () => {
    const list = new ReadingList(new KeyValueRepo(db()))
    list.add('https://news.example/story.php?id=1', 'One')
    list.add('https://news.example/story.php?id=2', 'Two')
    expect(list.list()).toHaveLength(2)
    list.markVisited('https://news.example/story.php?id=2#top')
    expect(list.list().map((item) => [item.title, item.readAt !== null])).toEqual([
      ['Two', true],
      ['One', false]
    ])
  })
})

describe('imported bookmark folders', () => {
  it('makes the folders and puts new bookmarks in them, leaving ones already saved where they are', () => {
    const bookmarks = new BookmarksRepo(db())
    bookmarks.toggle('https://kept.example/', 'Kept')
    const imported = [
      { url: 'https://kept.example/', title: 'Kept', folder: ['Work'] },
      { url: 'https://a.example/', title: 'A', folder: ['Work', 'Docs'] },
      { url: 'https://b.example/', title: 'B', folder: ['Work'] },
      { url: 'https://c.example/', title: 'C', folder: [] }
    ]
    const before = new Set(bookmarks.list().map((bookmark) => bookmark.url))
    bookmarks.importMany(imported)
    bookmarks.placeImported(imported, new Set(imported.map((bookmark) => bookmark.url).filter((url) => !before.has(url))))
    const groups = bookmarks.groups()
    const work = groups.find((group) => group.name === 'Work' && group.parentId === null)!
    const docs = groups.find((group) => group.name === 'Docs')!
    expect(docs.parentId).toBe(work.id)
    expect(groups).toHaveLength(2)
    const placed = Object.fromEntries(bookmarks.list().map((bookmark) => [bookmark.title, bookmark.groupId]))
    expect(placed).toEqual({ Kept: null, A: docs.id, B: work.id, C: null })
  })
})

describe('now playing', () => {
  it('drops a player paused more than half an hour ago, but never one that plays', () => {
    const now = 10_000_000
    expect(nowPlayingTab([{ id: 1, media: 'paused', mediaAt: now - PAUSED_SHOWN_MS - 1 }], [], now)).toBeNull()
    expect(nowPlayingTab([{ id: 1, media: 'paused', mediaAt: now - 60_000 }], [], now)?.id).toBe(1)
    expect(nowPlayingTab([{ id: 1, media: 'playing', mediaAt: 0 }], [], now)?.id).toBe(1)
    // The most recently paused, by time rather than by where its tab is.
    expect(nowPlayingTab([{ id: 1, media: 'paused', mediaAt: now - 5 }, { id: 2, media: 'paused', mediaAt: now - 500 }], [], now)?.id).toBe(1)
  })
})

describe('calendar days', () => {
  it('counts by the calendar, whatever the hour', () => {
    const lateLastNight = new Date(2026, 10, 25, 23, 30).getTime()
    const thisMorning = new Date(2026, 10, 26, 8, 0).getTime()
    expect(calendarDaysBetween(lateLastNight, thisMorning)).toBe(1)
    expect(calendarDaysBetween(thisMorning, thisMorning + 60_000)).toBe(0)
  })

  it('steps back a day at a time across a clock change', () => {
    // Sydney's clocks went forward on 4 October 2026; just after midnight the next day, a 24-hour step lands two days back.
    const justAfterMidnight = new Date(2026, 9, 5, 0, 30).getTime()
    expect(localDayBefore(justAfterMidnight, 1)).toBe('2026-10-04')
    expect(localDayBefore(justAfterMidnight, 0)).toBe('2026-10-05')
  })
})
