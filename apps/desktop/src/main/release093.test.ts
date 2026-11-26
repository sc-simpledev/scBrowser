import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_READER_STYLE } from '@scbrowser/shared'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, dialog: {}, session: {} }))

import { pageFileName, saveTypeFor } from './savePage'
import { readerStyleCss } from './internal/reader'
import { migrate } from './storage/database'
import { DownloadsRepo } from './storage/downloads'
import { HistoryRepo } from './storage/history'

function db() {
  const database = new DatabaseSync(':memory:')
  migrate(database)
  return database
}

describe('saving a page', () => {
  it('names the file after the title, without characters other systems refuse', () => {
    expect(pageFileName('What: a "guide" / part 2?', 'https://example.com/a')).toBe('What a guide part 2')
    expect(pageFileName('   ', 'https://www.example.com/a')).toBe('www.example.com')
    expect(pageFileName('x'.repeat(300), 'https://example.com/').length).toBe(120)
  })

  it('writes each kind by the ending chosen', () => {
    expect(saveTypeFor('/home/a/page.html')).toBe('HTMLComplete')
    expect(saveTypeFor('/home/a/page.mhtml')).toBe('MHTML')
    expect(saveTypeFor('/home/a/page.htm')).toBe('HTMLOnly')
  })
})

describe('clearing history and downloads by time', () => {
  it('forgets only pages last visited in the range', () => {
    const history = new HistoryRepo(db())
    const now = Date.now()
    history.recordVisit('https://old.example/', 'Old', now - 3 * 86_400_000)
    history.recordVisit('https://recent.example/', 'Recent', now - 60_000)
    expect(history.clearSince(now - 3_600_000)).toBe(1)
    expect(history.list('', 10, 0).map((entry) => entry.url)).toEqual(['https://old.example/'])
    expect(history.clearSince(0)).toBe(1)
    expect(history.list('', 10, 0)).toEqual([])
  })

  it('takes finished downloads off the list, leaving ones still going', () => {
    const repo = new DownloadsRepo(db())
    const now = Date.now()
    const item = (id: string, state: 'completed' | 'progressing' | 'paused', startedAt: number) => repo.save({ id, url: `https://example.com/${id}`, filename: id, path: `/tmp/${id}`, receivedBytes: 1, totalBytes: 1, state, startedAt })
    item('old', 'completed', now - 10 * 86_400_000)
    item('new', 'completed', now - 1000)
    item('going', 'progressing', now - 1000)
    item('paused', 'paused', now - 1000)
    repo.clearFinishedSince(now - 86_400_000)
    expect(repo.list().map((download) => download.id).sort()).toEqual(['going', 'old', 'paused'])
  })
})

describe('reader view styles', () => {
  it('adds nothing to the colours when they follow scTerra', () => {
    const css = readerStyleCss(DEFAULT_READER_STYLE)
    expect(css).not.toContain(':root')
    expect(css).toContain('font-size: 18px')
    expect(css).toContain('max-width: 680px')
  })

  it('sets paper colours, a serif and the width asked for', () => {
    const css = readerStyleCss({ font: 'serif', size: 'larger', width: 'wide', theme: 'sepia' })
    expect(css).toContain('--sc-surface: #f6efdf')
    expect(css).toContain('Georgia')
    expect(css).toContain('font-size: 24px')
    expect(css).toContain('max-width: 840px')
  })
})
