import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from './storage/database'
import { KeyValueRepo } from './storage/kv'
import { TabArchive } from './tabArchive'
import { ReadingList } from './readingList'

vi.mock('electron', () => ({}))
const { HighlightStore } = await import('./highlights')

const kv = () => {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return new KeyValueRepo(db)
}
const saved = (url: string) => ({ url, title: url, faviconUrl: null, entries: [], entryIndex: 0, container: null, lastActiveAt: 1 })

describe('tab archive', () => {
  it('keeps newest first, replaces the same page, and gives entries back once', () => {
    const archive = new TabArchive(kv(), () => undefined)
    archive.add([saved('https://a.com/'), saved('https://b.com/')], false, 10)
    archive.add([saved('https://a.com/')], true, 20)
    const list = archive.list()
    expect(list.map((tab) => tab.url)).toEqual(['https://a.com/', 'https://b.com/'])
    expect(list[0]).toMatchObject({ byHand: true, archivedAt: 20 })
    expect(archive.take(list[0]!.id)?.url).toBe('https://a.com/')
    expect(archive.take(list[0]!.id)).toBeNull()
    archive.clear()
    expect(archive.list()).toEqual([])
  })
})

describe('reading list', () => {
  it('adds each page once, marks it read when visited, and refuses other schemes', () => {
    const list = new ReadingList(kv())
    const item = list.add('https://a.com/story', 'Story')
    expect(list.add('https://a.com/story', 'Again').id).toBe(item.id)
    expect(() => list.add('sc://settings', 'x')).toThrow()
    list.markVisited('https://a.com/story')
    expect(list.get(item.id)?.readAt).not.toBeNull()
    list.patch(item.id, { readAt: null, summary: '- point' })
    expect(list.get(item.id)).toMatchObject({ readAt: null, summary: '- point' })
    list.remove(item.id)
    expect(list.list()).toEqual([])
  })
})

describe('highlights', () => {
  it('keeps one per page and text, by the page without its fragment', () => {
    const store = new HighlightStore(kv())
    const first = store.add('https://a.com/post#top', 'Post', '  some   words ')
    expect(first.text).toBe('some words')
    expect(store.add('https://a.com/post', 'Post', 'some words').id).toBe(first.id)
    expect(store.forPage('https://a.com/post#elsewhere')).toHaveLength(1)
    store.setNote(first.id, 'mine')
    expect(store.list()[0]?.note).toBe('mine')
    expect(() => store.add('https://a.com/post', 'Post', '   ')).toThrow()
    store.remove(first.id)
    expect(store.list()).toEqual([])
  })
})
