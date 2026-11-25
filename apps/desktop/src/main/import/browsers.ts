import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ImportSource } from '@scbrowser/shared'

const MAX_HISTORY = 20_000
/** Chromium counts microseconds since 1601. */
const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000

export interface ImportedBookmark {
  url: string
  title: string
  /** The folders it sits in, outermost first. Empty for the bookmarks bar itself. */
  folder?: string[]
}

/** Folders deeper than this are flattened into the deepest one kept. */
const MAX_FOLDER_DEPTH = 8

export interface ImportedVisit {
  url: string
  title: string
  visitCount: number
  lastVisit: number
}

interface BrowserLocation extends ImportSource {
  kind: 'chromium' | 'firefox'
  /** Profile folder for Chromium browsers, or the folder holding profiles.ini for Firefox. */
  path: string
}

const isWeb = (url: string) => /^https?:\/\//i.test(url)

export function browserLocations(platform = process.platform, home = homedir(), env = process.env): BrowserLocation[] {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const roaming = env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return [
      { id: 'chrome', name: 'Google Chrome', kind: 'chromium', path: join(local, 'Google', 'Chrome', 'User Data', 'Default') },
      { id: 'edge', name: 'Microsoft Edge', kind: 'chromium', path: join(local, 'Microsoft', 'Edge', 'User Data', 'Default') },
      { id: 'brave', name: 'Brave', kind: 'chromium', path: join(local, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default') },
      { id: 'firefox', name: 'Firefox', kind: 'firefox', path: join(roaming, 'Mozilla', 'Firefox') }
    ]
  }
  const config = join(home, '.config')
  return [
    { id: 'chrome', name: 'Google Chrome', kind: 'chromium', path: join(config, 'google-chrome', 'Default') },
    { id: 'chromium', name: 'Chromium', kind: 'chromium', path: join(config, 'chromium', 'Default') },
    { id: 'edge', name: 'Microsoft Edge', kind: 'chromium', path: join(config, 'microsoft-edge', 'Default') },
    { id: 'brave', name: 'Brave', kind: 'chromium', path: join(config, 'BraveSoftware', 'Brave-Browser', 'Default') },
    { id: 'firefox', name: 'Firefox', kind: 'firefox', path: join(home, '.mozilla', 'firefox') },
    { id: 'firefox-snap', name: 'Firefox (Snap)', kind: 'firefox', path: join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox') }
  ]
}

/** The profile Firefox marks as default, else the first listed. */
export function firefoxProfile(root: string): string | null {
  const ini = join(root, 'profiles.ini')
  if (!existsSync(ini)) return null
  const lines = readFileSync(ini, 'utf8').split(/\r?\n/)
  const installDefault = lines.find((line) => line.startsWith('Default=') && line.includes('/'))?.slice('Default='.length)
  const paths = lines.filter((line) => line.startsWith('Path=')).map((line) => line.slice('Path='.length))
  const chosen = [installDefault, ...paths].find((path) => path && existsSync(join(root, path, 'places.sqlite')))
  return chosen ? join(root, chosen) : null
}

export function availableSources(locations = browserLocations()): ImportSource[] {
  return locations
    .filter(({ kind, path }) => (kind === 'firefox' ? firefoxProfile(path) !== null : existsSync(join(path, 'History')) || existsSync(join(path, 'Bookmarks'))))
    .map(({ id, name }) => ({ id, name }))
}

/** The browser may be running and holding its database, so a copy is read instead. */
function withCopy<T>(file: string, read: (db: DatabaseSync) => T): T {
  const folder = mkdtempSync(join(tmpdir(), 'scb-import-'))
  const copy = join(folder, 'copy.sqlite')
  try {
    copyFileSync(file, copy)
    for (const suffix of ['-wal', '-shm']) if (existsSync(file + suffix)) copyFileSync(file + suffix, copy + suffix)
    const db = new DatabaseSync(copy)
    try {
      return read(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/**
 * Chrome's bookmarks with their folders. The bookmarks bar's own items go on scTerra's bar; "Other
 * bookmarks" and "Mobile bookmarks" become folders of those names.
 */
export function parseChromiumBookmarks(json: string): ImportedBookmark[] {
  const found: ImportedBookmark[] = []
  const walk = (node: unknown, folder: string[]) => {
    if (typeof node !== 'object' || node === null) return
    const { type, url, name, children } = node as { type?: string; url?: unknown; name?: unknown; children?: unknown }
    if (type === 'url' && typeof url === 'string' && isWeb(url)) found.push({ url, title: typeof name === 'string' ? name : '', folder })
    const inside = type === 'folder' && typeof name === 'string' && name.trim() && folder.length < MAX_FOLDER_DEPTH ? [...folder, name.trim().slice(0, 80)] : folder
    if (Array.isArray(children)) children.forEach((child) => walk(child, inside))
  }
  const { roots } = JSON.parse(json) as { roots?: Record<string, unknown> }
  for (const [key, root] of Object.entries(roots ?? {})) {
    if (typeof root !== 'object' || root === null) continue
    const { name, children } = root as { name?: unknown; children?: unknown }
    // The roots are folders too, except the bar, whose items are what the bar shows.
    const fallback = key === 'other' ? 'Other bookmarks' : key === 'synced' ? 'Mobile bookmarks' : key
    const top = key === 'bookmark_bar' ? [] : [typeof name === 'string' && name.trim() ? name.trim() : fallback]
    if (Array.isArray(children)) children.forEach((child) => walk(child, top))
  }
  return found
}

export function readChromiumHistory(file: string): ImportedVisit[] {
  return withCopy(file, (db) =>
    (db
      // Divided here because these values are too large for a JavaScript number.
      .prepare(`SELECT url, title, visit_count, last_visit_time / 1000 AS visited_ms FROM urls ORDER BY last_visit_time DESC LIMIT ?`)
      .all(MAX_HISTORY) as unknown as { url: string; title: string; visit_count: number; visited_ms: number }[])
      .filter((row) => isWeb(row.url))
      .map((row) => ({
        url: row.url,
        title: row.title,
        visitCount: row.visit_count,
        lastVisit: Math.max(0, row.visited_ms - CHROME_EPOCH_OFFSET_MS)
      }))
  )
}

export function readFirefoxPlaces(file: string): { bookmarks: ImportedBookmark[]; history: ImportedVisit[] } {
  return withCopy(file, (db) => {
    const folders = new Map(
      (db.prepare(`SELECT id, parent, COALESCE(title, '') AS title, COALESCE(guid, '') AS guid FROM moz_bookmarks WHERE type = 2`).all() as unknown as { id: number; parent: number; title: string; guid: string }[]).map((row) => [row.id, row])
    )
    // Firefox's own roots: the toolbar is scTerra's bar, the others become folders of their own.
    const ROOT_NAMES: Record<string, string | null> = { toolbar_____: null, menu________: 'Bookmarks menu', unfiled_____: 'Other bookmarks', mobile______: 'Mobile bookmarks', root________: null }
    const pathOf = (parent: number): string[] => {
      const names: string[] = []
      const seen = new Set<number>()
      for (let at = folders.get(parent); at && !seen.has(at.id); at = folders.get(at.parent)) {
        seen.add(at.id)
        if (Object.hasOwn(ROOT_NAMES, at.guid)) {
          const root = ROOT_NAMES[at.guid]
          if (root) names.unshift(root)
          break
        }
        if (at.title.trim()) names.unshift(at.title.trim().slice(0, 80))
      }
      return names.slice(0, MAX_FOLDER_DEPTH)
    }
    const bookmarks = (db
      .prepare(`SELECT p.url AS url, COALESCE(b.title, p.title, '') AS title, b.parent AS parent FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1`)
      .all() as unknown as (ImportedBookmark & { parent: number | null })[])
      .filter((row) => isWeb(row.url))
      .map(({ url, title, parent }) => ({ url, title, folder: parent === null ? [] : pathOf(parent) }))
    const history = (db
      .prepare(`SELECT url, COALESCE(title, '') AS title, visit_count, last_visit_date FROM moz_places
                WHERE last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT ?`)
      .all(MAX_HISTORY) as unknown as { url: string; title: string; visit_count: number; last_visit_date: number }[])
      .filter((row) => isWeb(row.url))
      .map((row) => ({
        url: row.url,
        title: row.title,
        visitCount: row.visit_count,
        lastVisit: Math.round(row.last_visit_date / 1000)
      }))
    return { bookmarks, history }
  })
}

/** Reads one browser's bookmarks and history. Passwords and cookies are never touched. */
export function readSource(id: string, locations = browserLocations()): { bookmarks: ImportedBookmark[]; history: ImportedVisit[] } {
  const location = locations.find((l) => l.id === id)
  if (!location) throw new Error('Unknown browser')
  if (location.kind === 'firefox') {
    const profile = firefoxProfile(location.path)
    if (!profile) throw new Error('No Firefox profile found')
    return readFirefoxPlaces(join(profile, 'places.sqlite'))
  }
  const bookmarksFile = join(location.path, 'Bookmarks')
  const historyFile = join(location.path, 'History')
  return {
    bookmarks: existsSync(bookmarksFile) ? parseChromiumBookmarks(readFileSync(bookmarksFile, 'utf8')) : [],
    history: existsSync(historyFile) ? readChromiumHistory(historyFile) : []
  }
}
