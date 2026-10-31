import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { EMPTY_SYNC, LOCAL_SETTINGS, MAX_SYNCED_HISTORY, mergeSync, sanitizeSettings, type Settings, type SyncData, type SyncStatus } from '@scbrowser/shared'
import type { SettingsStore } from './settings'
import type { BookmarksRepo } from './storage/bookmarks'
import type { HistoryRepo } from './storage/history'
import type { KeyValueRepo } from './storage/kv'

const CONFIG_KEY = 'sync:config'
const FILE_NAME = 'scdelta-sync.bin'
const FORMAT = 'scdelta-sync-1'
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16

export const MIN_PASSPHRASE = 10

export const deriveKey = (passphrase: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(passphrase.normalize('NFKC'), salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key)))
  })

/** Layout: format line, salt, IV, tag, ciphertext. The salt is what lets other devices derive the key. */
export function seal(data: SyncData, key: Buffer, salt: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const header = Buffer.concat([Buffer.from(`${FORMAT}\n`), salt])
  cipher.setAAD(header)
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(data))), cipher.final()])
  return Buffer.concat([header, iv, cipher.getAuthTag(), body])
}

export function saltOf(file: Buffer): Buffer {
  const start = FORMAT.length + 1
  if (file.subarray(0, start).toString() !== `${FORMAT}\n`) throw new Error("That folder's sync file isn't one scDelta can read.")
  return file.subarray(start, start + SALT_BYTES)
}

/** Throws if the key is wrong or the file was changed. */
export function unseal(file: Buffer, key: Buffer): SyncData {
  const salt = saltOf(file)
  const headerEnd = FORMAT.length + 1 + salt.length
  const iv = file.subarray(headerEnd, headerEnd + IV_BYTES)
  const tag = file.subarray(headerEnd + IV_BYTES, headerEnd + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(file.subarray(0, headerEnd))
  decipher.setAuthTag(tag)
  const zipped = Buffer.concat([decipher.update(file.subarray(headerEnd + IV_BYTES + TAG_BYTES)), decipher.final()])
  const data = JSON.parse(gunzipSync(zipped).toString()) as Partial<SyncData>
  return { ...EMPTY_SYNC, ...data }
}

export interface KeyVault {
  encrypt: (value: string) => string
  decrypt: (value: string) => string
}

interface SyncConfig {
  folder: string
  /** Protected by the system keychain. The passphrase itself is never kept. */
  key: string
  salt: string
  lastSync: number | null
}

interface SyncDeps {
  kv: KeyValueRepo
  settings: SettingsStore
  history: HistoryRepo
  bookmarks: BookmarksRepo
  vault: KeyVault
  /** Holds how things looked after the last sync. */
  basePath: string
  onBookmarksChanged: () => void
}

/**
 * End-to-end encrypted sync through a folder the person already syncs, such as Syncthing or
 * Dropbox. The folder only ever holds ciphertext, so its provider can't read anything.
 */
export class SyncService {
  private running = false
  private error: string | null = null
  private stopped = false

  constructor(private readonly deps: SyncDeps) {}

  private get config(): SyncConfig | undefined {
    return this.deps.kv.get(CONFIG_KEY) as SyncConfig | undefined
  }

  status(): SyncStatus {
    const config = this.config
    return { folder: config?.folder ?? null, lastSync: config?.lastSync ?? null, error: this.error, running: this.running }
  }

  async enable(folder: string, passphrase: string): Promise<SyncStatus> {
    if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`)
    const path = join(folder, FILE_NAME)
    const existing = existsSync(path) ? await readFile(path) : null
    const salt = existing ? saltOf(existing) : randomBytes(SALT_BYTES)
    const key = await deriveKey(passphrase, salt)
    if (existing) {
      try {
        unseal(existing, key)
      } catch {
        throw new Error("That passphrase doesn't match the one used on your other device.")
      }
    }
    rmSync(this.deps.basePath, { force: true })
    this.deps.kv.set(CONFIG_KEY, {
      folder,
      key: this.deps.vault.encrypt(key.toString('base64')),
      salt: salt.toString('base64'),
      lastSync: null
    } satisfies SyncConfig)
    return this.run()
  }

  /** Leaves the folder alone, so other devices keep working. */
  disable(): void {
    this.deps.kv.delete(CONFIG_KEY)
    rmSync(this.deps.basePath, { force: true })
    this.error = null
  }

  /** No more writes after this; the database may close. */
  stop(): void {
    this.stopped = true
  }

  async run(): Promise<SyncStatus> {
    const config = this.config
    if (!config || this.running) return this.status()
    this.running = true
    try {
      const key = Buffer.from(this.deps.vault.decrypt(config.key), 'base64')
      const path = join(config.folder, FILE_NAME)
      const file = await readFile(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      const remote = file ? unseal(file, key) : EMPTY_SYNC
      if (this.stopped) return this.status()
      const base = this.readBase()
      const local = this.snapshot(base)
      // A device joining takes the settings already in use, rather than pushing its defaults.
      const joining = Object.keys(base.settings).length === 0 && Object.keys(remote.settings).length > 0
      const merged = mergeSync(base, joining ? { ...local, settings: remote.settings } : local, remote)
      this.apply(local, merged)
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, seal(merged, key, Buffer.from(config.salt, 'base64')))
      await rename(temporary, path)
      writeFileSync(this.deps.basePath, JSON.stringify(merged))
      if (!this.stopped) this.deps.kv.set(CONFIG_KEY, { ...config, lastSync: Date.now() })
      this.error = null
    } catch (error) {
      this.error = syncError(error)
    } finally {
      this.running = false
    }
    return this.status()
  }

  private readBase(): SyncData {
    try {
      return { ...EMPTY_SYNC, ...(JSON.parse(readFileSync(this.deps.basePath, 'utf8')) as Partial<SyncData>) }
    } catch {
      return EMPTY_SYNC
    }
  }

  private snapshot(base: SyncData): SyncData {
    const { bookmarks, history, settings } = this.deps
    const current = settings.get()
    const synced = Object.fromEntries(Object.entries(current).filter(([key]) => !LOCAL_SETTINGS.includes(key as keyof Settings)))
    const visits: SyncData['history'] = {}
    if (current.syncHistory) {
      for (const { url, title, visitCount, lastVisit } of history.list('', MAX_SYNCED_HISTORY, 0)) visits[url] = { title, visitCount, lastVisit }
      // Older than the window isn't the same as deleted.
      for (const url of Object.keys(base.history)) {
        if (visits[url]) continue
        const entry = history.find(url)
        if (entry) visits[url] = { title: entry.title, visitCount: entry.visitCount, lastVisit: entry.lastVisit }
      }
    }
    return {
      bookmarks: Object.fromEntries(bookmarks.list().map(({ url, title }) => [url, title])),
      // With history switched off, leave what's in the folder as it is.
      history: current.syncHistory ? visits : base.history,
      settings: synced
    }
  }

  private apply(local: SyncData, merged: SyncData): void {
    const { bookmarks, history, settings, onBookmarksChanged } = this.deps
    const saved = bookmarks.list()
    const added = Object.entries(merged.bookmarks).filter(([url]) => !Object.hasOwn(local.bookmarks, url))
    bookmarks.importMany(added.map(([url, title]) => ({ url, title })))
    let changed = added.length > 0
    for (const { id, url, title } of saved) {
      if (!Object.hasOwn(merged.bookmarks, url)) bookmarks.remove(id)
      else if (merged.bookmarks[url] !== title) bookmarks.rename(id, merged.bookmarks[url]!)
      else continue
      changed = true
    }
    if (changed) onBookmarksChanged()

    if (settings.get().syncHistory) {
      for (const url of Object.keys(local.history)) {
        if (!Object.hasOwn(merged.history, url) && !this.cappedOut(url, merged)) history.delete(url)
      }
      history.applySynced(Object.entries(merged.history).map(([url, visit]) => ({ url, ...visit })))
    }

    const patch = sanitizeSettings(merged.settings)
    const current = settings.get()
    const differs = Object.entries(patch).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(current[key as keyof Settings]))
    if (differs) settings.set(patch)
  }

  /** The merge also drops the oldest visits to stay small; those stay on this device. */
  private cappedOut(url: string, merged: SyncData): boolean {
    const oldest = Math.min(...Object.values(merged.history).map((visit) => visit.lastVisit))
    return Object.keys(merged.history).length >= MAX_SYNCED_HISTORY && (this.deps.history.find(url)?.lastVisit ?? 0) < oldest
  }
}

function syncError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return "The sync folder can't be found."
  if (code === 'EACCES' || code === 'EPERM') return "scDelta isn't allowed to write to the sync folder."
  if (error instanceof Error && /authenticate|unsupported state/i.test(error.message)) return 'The sync file was changed by something else, or encrypted with another passphrase.'
  return error instanceof Error ? error.message : "Sync didn't finish."
}
