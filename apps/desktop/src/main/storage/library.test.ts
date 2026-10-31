import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { BookmarksRepo } from './bookmarks'
import { ChatsRepo } from './chats'
import { migrate } from './database'
import { DownloadsRepo } from './downloads'
import { HistoryRepo } from './history'
import { KeyValueRepo } from './kv'
import { PermissionsRepo } from './permissions'

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

describe('BookmarksRepo', () => {
  it('toggles a URL on and off', () => {
    const repo = new BookmarksRepo(db)
    repo.toggle('https://a.dev/', 'A')
    expect(repo.list().map((b) => b.title)).toEqual(['A'])
    repo.toggle('https://a.dev/', 'A')
    expect(repo.list()).toEqual([])
  })
})

describe('ChatsRepo', () => {
  const turns = [
    { role: 'user' as const, content: 'A very long first question '.repeat(10) },
    { role: 'assistant' as const, content: 'Answer' }
  ]

  it('saves, updates, lists newest first and deletes', () => {
    const repo = new ChatsRepo(db)
    repo.save('a', turns, 1)
    repo.save('b', turns, 2)
    repo.save('a', [...turns, { role: 'user', content: 'More' }], 3)
    expect(repo.list().map((c) => c.id)).toEqual(['a', 'b'])
    expect(repo.list()[0]?.title.length).toBeLessThanOrEqual(80)
    expect(repo.get('a')?.turns).toHaveLength(3)
    repo.delete('a')
    expect(repo.get('a')).toBeNull()
    repo.clear()
    expect(repo.list()).toEqual([])
  })
})

describe('KeyValueRepo', () => {
  it('round-trips JSON and tolerates corrupt values', () => {
    const repo = new KeyValueRepo(db)
    repo.set('a', { n: 1 })
    expect(repo.get('a')).toEqual({ n: 1 })
    expect(repo.get('missing')).toBeUndefined()
    db.exec(`INSERT INTO kv VALUES ('bad', '{')`)
    expect(repo.get('bad')).toBeUndefined()
  })
})

describe('DownloadsRepo', () => {
  const item = {
    id: 'x',
    url: 'https://a.dev/f.zip',
    filename: 'f.zip',
    path: '/tmp/f.zip',
    receivedBytes: 1,
    totalBytes: 2,
    state: 'progressing' as const,
    startedAt: 1
  }

  it('marks unfinished downloads as interrupted on the next start', () => {
    new DownloadsRepo(db).save(item)
    expect(new DownloadsRepo(db).list()[0]?.state).toBe('interrupted')
  })

  it('clears only finished downloads', () => {
    const repo = new DownloadsRepo(db)
    repo.save(item)
    repo.save({ ...item, id: 'y', state: 'completed' })
    repo.clearFinished()
    expect(repo.list().map((d) => d.id)).toEqual(['x'])
  })
})

describe('PermissionsRepo', () => {
  it('stores and revokes per-origin decisions', () => {
    const repo = new PermissionsRepo(db)
    expect(repo.get('https://a.dev', 'camera')).toBeUndefined()
    repo.set('https://a.dev', 'camera', false)
    expect(repo.get('https://a.dev', 'camera')).toBe(false)
    repo.revoke('https://a.dev', 'camera')
    expect(repo.list()).toEqual([])
  })
})

describe('importing', () => {
  it('keeps existing data and reports only what was new', () => {
    const history = new HistoryRepo(db)
    history.recordVisit('https://a.dev/', 'Mine', 5)
    const entries = [
      { url: 'https://a.dev/', title: 'Theirs', visitCount: 9, lastVisit: 1 },
      { url: 'https://b.dev/', title: 'B', visitCount: 2, lastVisit: 1 }
    ]
    expect(history.importMany(entries)).toBe(1)
    expect(history.list('a.dev', 10, 0)[0]?.title).toBe('Mine')

    const bookmarks = new BookmarksRepo(db)
    bookmarks.toggle('https://a.dev/', 'Mine')
    expect(bookmarks.importMany([{ url: 'https://a.dev/', title: 'X' }, { url: 'https://c.dev/', title: 'C' }, { url: 'https://c.dev/', title: 'C' }])).toBe(1)
  })
})

describe('HistoryRepo management', () => {
  it('lists newest first, deletes and clears', () => {
    const repo = new HistoryRepo(db)
    repo.recordVisit('https://a.dev/', 'A', 1)
    repo.recordVisit('https://b.dev/', 'B', 2)
    expect(repo.list('', 10, 0).map((e) => e.title)).toEqual(['B', 'A'])
    repo.delete('https://b.dev/')
    expect(repo.list('', 10, 0).map((e) => e.title)).toEqual(['A'])
    repo.clear()
    expect(repo.list('', 10, 0)).toEqual([])
  })
})
