import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { app, shell, type DownloadItem, type Session } from 'electron'
import { downloadFolderFor, type DownloadAction, type DownloadInfo } from '@scbrowser/shared'
import type { SettingsStore } from './settings'
import type { DownloadsRepo } from './storage/downloads'

const SAVE_INTERVAL_MS = 1000

interface Live {
  item: DownloadItem
  info: DownloadInfo
  savedAt: number
}

/** "report.pdf" → "report (1).pdf" when the name is taken on disk or by a running download. */
export function uniquePath(dir: string, filename: string, taken: (path: string) => boolean): string {
  const name = basename(filename) || 'download'
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  let candidate = join(dir, name)
  for (let n = 1; taken(candidate); n++) candidate = join(dir, `${stem} (${n})${extension}`)
  return candidate
}

export class DownloadManager {
  private readonly live = new Map<string, Live>()

  constructor(
    private readonly repo: DownloadsRepo,
    private readonly settings: SettingsStore,
    private readonly onProgress: (progress: { active: number; fraction: number | null }) => void
  ) {}

  attach(session: Session): void {
    session.on('will-download', (_event, item, contents) => this.track(item, contents?.getURL() ?? ''))
  }

  list(): DownloadInfo[] {
    return this.repo.list().map((info) => this.live.get(info.id)?.info ?? info)
  }

  act(id: string, action: DownloadAction): void {
    const live = this.live.get(id)
    const info = live?.info ?? this.repo.list().find((d) => d.id === id)
    if (!info) return
    if (action === 'pause') live?.item.pause()
    if (action === 'resume' && live?.item.canResume()) live.item.resume()
    if (action === 'cancel') live?.item.cancel()
    if (action === 'open' && info.state === 'completed') void shell.openPath(info.path)
    if (action === 'show') shell.showItemInFolder(info.path)
    if (action === 'remove' && !live) this.repo.remove(id)
  }

  /** Renames a finished download in its own folder, keeping clear of names already there. Returns the new name. */
  async rename(id: string, name: string): Promise<string> {
    const info = this.repo.list().find((d) => d.id === id)
    if (!info || info.state !== 'completed' || this.live.has(id)) throw new Error('Only finished downloads can be renamed.')
    if (!existsSync(info.path)) throw new Error('The file has been moved or deleted.')
    const target = uniquePath(dirname(info.path), basename(name), (p) => p !== info.path && existsSync(p))
    if (target !== info.path) await rename(info.path, target)
    const next = { ...info, path: target, filename: basename(target) }
    this.repo.save(next)
    return next.filename
  }

  clearFinished(): void {
    this.repo.clearFinished()
  }

  private track(item: DownloadItem, pageUrl: string): void {
    const { downloadDir, askWhereToSave, downloadRules } = this.settings.get()
    // A rule's folder wins, as long as it's still there.
    const ruled = downloadFolderFor(downloadRules, item.getFilename(), item.getURL(), pageUrl)
    const dir = (ruled && existsSync(ruled) ? ruled : null) || downloadDir || app.getPath('downloads')
    const running = new Set([...this.live.values()].map((l) => l.info.path))
    const path = uniquePath(dir, item.getFilename(), (p) => existsSync(p) || running.has(p))
    // With a dialog, Chromium asks the user and reports the chosen path through the item.
    if (askWhereToSave) item.setSaveDialogOptions({ defaultPath: path })
    else item.setSavePath(path)

    const info: DownloadInfo = {
      id: randomUUID(),
      url: item.getURL(),
      filename: basename(path),
      path,
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      state: 'progressing',
      startedAt: Date.now()
    }
    const live: Live = { item, info, savedAt: 0 }
    this.live.set(info.id, live)
    this.update(live)

    item.on('updated', (_event, state) => {
      info.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      this.update(live)
    })
    item.once('done', (_event, state) => {
      info.state = state
      this.live.delete(info.id)
      this.update(live, true)
    })
  }

  private update(live: Live, force = false): void {
    const { item, info } = live
    const savePath = item.getSavePath()
    if (savePath) {
      info.path = savePath
      info.filename = basename(savePath)
    }
    info.receivedBytes = item.getReceivedBytes()
    info.totalBytes = item.getTotalBytes()

    const now = Date.now()
    if (force || now - live.savedAt >= SAVE_INTERVAL_MS) {
      this.repo.save(info)
      live.savedAt = now
    }

    const running = [...this.live.values()].map((l) => l.info)
    const total = running.reduce((sum, d) => sum + d.totalBytes, 0)
    const received = running.reduce((sum, d) => sum + d.receivedBytes, 0)
    const known = running.length > 0 && running.every((d) => d.totalBytes > 0)
    this.onProgress({ active: running.length, fraction: known ? received / total : null })
  }
}
