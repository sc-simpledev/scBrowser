import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_NEW_TAB, type Bookmark, type NewTabConfig, type Settings } from '@scbrowser/shared'
import type { SettingsStore } from './settings'
import type { BookmarksRepo } from './storage/bookmarks'

const FLAG = '--private='
const PREFIX = 'scterra-private-'
const SEED = 'seed.json'
const PID = 'owner.pid'

interface Seed {
  settings: Settings
  bookmarks: Pick<Bookmark, 'url' | 'title' | 'icon'>[]
}

const folder = process.argv.find((arg) => arg.startsWith(FLAG))?.slice(FLAG.length)
const valid = !!folder && dirname(folder) === tmpdir() && basename(folder).startsWith(PREFIX)

/** A private window is its own copy of the app, running from a throwaway folder. */
export const isPrivate = valid

/** Must run before the app is ready. */
export function applyPrivate(): void {
  if (!valid) return
  app.setPath('userData', folder)
  writeFileSync(join(folder, PID), String(process.pid))
  watchForExit(folder!)
}

/** Waits for this process to end, then deletes the folder until it stays gone. */
const CLEANUP = `
const { existsSync, rmSync } = require('node:fs')
const [pid, dir] = process.argv.slice(1)
const alive = () => { try { process.kill(Number(pid), 0); return true } catch { return false } }
let quiet = 0
const timer = setInterval(() => {
  if (alive()) return
  if (existsSync(dir)) {
    quiet = 0
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  } else if (++quiet >= 12) clearInterval(timer)
}, 250)
`

/**
 * Chromium's helper processes keep writing past the end of shutdown, so nothing inside the app
 * can delete the folder for good. A small watcher outlives them, and it covers crashes too.
 */
function watchForExit(dir: string): void {
  spawn(process.execPath, ['-e', CLEANUP, String(process.pid), dir], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }).unref()
}

/** Bookmarks and settings come along. AI keys, history, extensions and saved logins don't. */
export function openPrivateWindow(settings: Settings, bookmarks: Bookmark[]): void {
  const dir = mkdtempSync(join(tmpdir(), PREFIX))
  const seed: Seed = { settings, bookmarks: bookmarks.map(({ url, title, icon }) => ({ url, title, icon })) }
  writeFileSync(join(dir, SEED), JSON.stringify(seed), { mode: 0o600 })
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), `${FLAG}${dir}`]
  spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref()
}

function privateNewTab(saved: NewTabConfig): NewTabConfig {
  const config = { ...DEFAULT_NEW_TAB, ...saved }
  return {
    ...config,
    // Quick AI has no key here, and notes and pictures belong to the main profile.
    widgets: config.widgets.filter((widget) => widget.id !== 'ai' && widget.id !== 'notes'),
    background: config.background === 'image' ? 'none' : config.background,
    imageVersion: 0,
    notes: '',
    topSites: false
  }
}

export function seedPrivate(settings: SettingsStore, bookmarks: BookmarksRepo): void {
  const path = join(folder!, SEED)
  let seed: Seed
  try {
    seed = JSON.parse(readFileSync(path, 'utf8')) as Seed
  } catch {
    settings.set({ theme: 'dark', startup: 'new-tab' })
    return
  }
  rmSync(path, { force: true })
  settings.set({ ...seed.settings, theme: 'dark', startup: 'new-tab', saveChats: false, crashReports: false, usageStats: false, newTab: privateNewTab(seed.settings.newTab) })
  bookmarks.importMany(seed.bookmarks)
  for (const { url, icon } of seed.bookmarks) if (icon && URL.canParse(url)) bookmarks.setIcon(new URL(url).host, icon)
}

const running = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Clears anything left by a private window that crashed, or lost a race with its own shutdown. */
export function sweepPrivate(): void {
  for (const name of readdirSync(tmpdir()).filter((entry) => entry.startsWith(PREFIX))) {
    const dir = join(tmpdir(), name)
    try {
      if (!running(Number(readFileSync(join(dir, PID), 'utf8')))) rmSync(dir, { recursive: true, force: true })
    } catch {
      // A folder still being set up has no owner yet, so the next launch deals with it.
    }
  }
}
