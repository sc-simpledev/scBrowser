import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { availableSources, firefoxProfile, parseChromiumBookmarks, readChromiumHistory, readFirefoxPlaces, readSource } from './browsers'

const dir = () => mkdtempSync(join(tmpdir(), 'scb-test-'))

function chromeProfile(root: string) {
  writeFileSync(
    join(root, 'Bookmarks'),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: 'folder',
          children: [
            { type: 'url', name: 'Docs', url: 'https://docs.dev/' },
            { type: 'url', name: 'Settings', url: 'chrome://settings' },
            { type: 'folder', children: [{ type: 'url', name: 'Nested', url: 'https://nested.dev/' }] }
          ]
        }
      }
    })
  )
  const db = new DatabaseSync(join(root, 'History'))
  db.exec(`CREATE TABLE urls (url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER)`)
  // 2020-01-01T00:00:00Z in Chromium time.
  db.exec(`INSERT INTO urls VALUES ('https://a.dev/', 'A', 3, 13222310400000000), ('chrome://flags', 'Flags', 1, 13222310400000001)`)
  db.close()
}

function firefoxRoot(root: string) {
  const profile = join(root, 'abc.default-release')
  mkdirSync(profile)
  writeFileSync(join(root, 'profiles.ini'), '[Install1]\nDefault=abc.default-release/\n\n[Profile0]\nPath=abc.default-release\n')
  writeFileSync(join(root, 'installs.ini'), '')
  const db = new DatabaseSync(join(profile, 'places.sqlite'))
  db.exec(`CREATE TABLE moz_places (id INTEGER, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER);
    CREATE TABLE moz_bookmarks (id INTEGER, fk INTEGER, type INTEGER, title TEXT);
    INSERT INTO moz_places VALUES (1, 'https://fox.dev/', 'Fox', 2, 1577836800000000), (2, 'place:sort=8', NULL, 0, NULL), (3, 'https://never.dev/', 'Never', 0, NULL);
    INSERT INTO moz_bookmarks VALUES (1, 1, 1, 'Fox bookmark'), (2, 2, 1, 'Query'), (3, NULL, 2, 'Folder');`)
  db.close()
}

describe('Chromium import', () => {
  it('walks folders and skips non-web addresses', () => {
    const root = dir()
    chromeProfile(root)
    const bookmarks = parseChromiumBookmarks(JSON.stringify({ roots: { a: { children: [{ type: 'url', name: 'X', url: 'https://x.dev/' }] } } }))
    expect(bookmarks).toEqual([{ url: 'https://x.dev/', title: 'X' }])
  })

  it('converts visit times', () => {
    const root = dir()
    chromeProfile(root)
    expect(readChromiumHistory(join(root, 'History'))).toEqual([
      { url: 'https://a.dev/', title: 'A', visitCount: 3, lastVisit: Date.UTC(2020, 0, 1) }
    ])
  })

  it('reads a whole profile', () => {
    const root = dir()
    chromeProfile(root)
    const location = { id: 'chrome', name: 'Chrome', kind: 'chromium' as const, path: root }
    expect(availableSources([location])).toEqual([{ id: 'chrome', name: 'Chrome' }])
    const { bookmarks, history } = readSource('chrome', [location])
    expect(bookmarks.map((b) => b.title)).toEqual(['Docs', 'Nested'])
    expect(history).toHaveLength(1)
  })
})

describe('Firefox import', () => {
  it('finds the default profile', () => {
    const root = dir()
    firefoxRoot(root)
    expect(firefoxProfile(root)).toBe(join(root, 'abc.default-release/'))
    expect(firefoxProfile(dir())).toBeNull()
  })

  it('reads bookmarks and visited history only', () => {
    const root = dir()
    firefoxRoot(root)
    const { bookmarks, history } = readFirefoxPlaces(join(root, 'abc.default-release', 'places.sqlite'))
    expect(bookmarks).toEqual([{ url: 'https://fox.dev/', title: 'Fox bookmark' }])
    expect(history).toEqual([{ url: 'https://fox.dev/', title: 'Fox', visitCount: 2, lastVisit: Date.UTC(2020, 0, 1) }])
  })
})
