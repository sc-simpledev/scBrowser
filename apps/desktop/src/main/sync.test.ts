import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_SYNC } from '@scbrowser/shared'

vi.mock('electron', () => ({ nativeTheme: { themeSource: 'system' } }))

import { SettingsStore } from './settings'
import { BookmarksRepo } from './storage/bookmarks'
import { migrate } from './storage/database'
import { HistoryRepo } from './storage/history'
import { KeyValueRepo } from './storage/kv'
import { deriveKey, saltOf, seal, SyncService, unseal } from './sync'

const salt = Buffer.alloc(16, 7)
const data = { ...EMPTY_SYNC, bookmarks: { 'https://a.example/': 'Private title' } }

describe('sync encryption', () => {
  it('round trips, and hides what it holds', async () => {
    const key = await deriveKey('correct horse', salt)
    const file = seal(data, key, salt)
    expect(file.includes('Private title')).toBe(false)
    expect(file.includes('a.example')).toBe(false)
    expect(saltOf(file)).toEqual(salt)
    expect(unseal(file, key)).toEqual(data)
  })

  it('refuses the wrong passphrase and any change to the file', async () => {
    const key = await deriveKey('correct horse', salt)
    const file = seal(data, key, salt)
    expect(() => unseal(file, Buffer.alloc(32))).toThrow()
    const changed = Buffer.from(file)
    changed[changed.length - 1]! ^= 1
    expect(() => unseal(changed, key)).toThrow()
  })
})

function device(folder: string) {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const kv = new KeyValueRepo(db)
  const settings = new SettingsStore(kv)
  const history = new HistoryRepo(db)
  const bookmarks = new BookmarksRepo(db)
  const dir = mkdtempSync(join(tmpdir(), 'scb-sync-'))
  const sync = new SyncService({
    kv,
    settings,
    history,
    bookmarks,
    vault: { encrypt: (v) => v, decrypt: (v) => v },
    basePath: join(dir, 'base.json'),
    onBookmarksChanged: () => undefined
  })
  return { sync, settings, history, bookmarks, folder }
}

describe('SyncService', () => {
  const PASS = 'a long passphrase'
  const urls = (d: ReturnType<typeof device>) => d.bookmarks.list().map((b) => b.url).sort()

  it('carries bookmarks, history and settings between devices', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'scb-folder-'))
    const one = device(folder)
    const two = device(folder)
    one.bookmarks.toggle('https://one.example/', 'One')
    one.history.recordVisit('https://seen.example/', 'Seen')
    one.settings.set({ accent: 'iris', downloadDir: '/home/one' })
    two.bookmarks.toggle('https://two.example/', 'Two')

    expect((await one.sync.enable(folder, PASS)).error).toBeNull()
    expect((await two.sync.enable(folder, PASS)).error).toBeNull()
    await one.sync.run()

    expect(urls(one)).toEqual(['https://one.example/', 'https://two.example/'])
    expect(urls(two)).toEqual(['https://one.example/', 'https://two.example/'])
    expect(two.history.find('https://seen.example/')?.title).toBe('Seen')
    expect(two.settings.get().accent).toBe('iris')
    expect(one.settings.get().accent).toBe('iris')
    expect(two.settings.get().downloadDir).toBe('')
    expect(readFileSync(join(folder, 'scdelta-sync.bin')).includes('one.example')).toBe(false)
  })

  it('carries deletions, and clearing history stays cleared', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'scb-folder-'))
    const one = device(folder)
    const two = device(folder)
    one.bookmarks.toggle('https://gone.example/', 'Gone')
    one.history.recordVisit('https://gone.example/', 'Gone')
    await one.sync.enable(folder, PASS)
    await two.sync.enable(folder, PASS)
    await one.sync.run()

    two.bookmarks.toggle('https://gone.example/', 'Gone')
    two.history.clear()
    await two.sync.run()
    await one.sync.run()
    await two.sync.run()
    expect(urls(one)).toEqual([])
    expect(one.history.find('https://gone.example/')).toBeNull()
    expect(two.history.find('https://gone.example/')).toBeNull()
  })

  it('refuses a passphrase that differs from the folder, changing nothing', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'scb-folder-'))
    const one = device(folder)
    const two = device(folder)
    await one.sync.enable(folder, PASS)
    await expect(two.sync.enable(folder, 'another passphrase')).rejects.toThrow("doesn't match")
    expect(two.sync.status().folder).toBeNull()
  })

  it('reports damage in the status and leaves local data alone', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'scb-folder-'))
    const one = device(folder)
    one.bookmarks.toggle('https://keep.example/', 'Keep')
    await one.sync.enable(folder, PASS)
    writeFileSync(join(folder, 'scdelta-sync.bin'), 'not ours')
    expect((await one.sync.run()).error).toBeTruthy()
    expect(urls(one)).toEqual(['https://keep.example/'])
  })
})
