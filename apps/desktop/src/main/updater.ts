import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, net, shell } from 'electron'
import { autoUpdater, CancellationToken, type UpdateInfo } from 'electron-updater'
import { compareVersions, IDLE_UPDATE, previousRelease, releaseDownloadBase, RELEASES_API_URL, RELEASES_URL, WHATS_NEW, type UpdateState } from '@scbrowser/shared'
import { canReplaceApp, stageUpdate, swapOnExit, zipForArch } from './macUpdate'
import { isPrivate } from './private'
import type { SettingsStore } from './settings'

const FIRST_CHECK_MS = 30_000
const CHECK_EVERY_MS = 4 * 60 * 60_000
/** Time for the update screen to draw, as installing can hold up this process. */
const INSTALL_PAINT_MS = 400
/** A failed check or download goes again by itself after these waits, so nobody has to restart to get it. */
export const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000]
/** A download that hasn't moved for this long is given up on and started again. */
export const STALL_MS = 90_000

const LAST_VERSION_KEY = 'app:last-version'
const WHATS_NEW_KEY = 'updates:whats-new'

/** electron-updater downloads through its own session, which the VPN has to reach as well. */
export const UPDATER_PARTITION = 'electron-updater'

/** Tests serve a release from this computer. */
const testFeed = () => (process.env.SCB_E2E ? process.env.SCB_UPDATE_URL : undefined)
const delay = (index: number) => (process.env.SCB_E2E && process.env.SCB_UPDATE_RETRY_MS ? Number(process.env.SCB_UPDATE_RETRY_MS) : RETRY_DELAYS_MS[index]!)

/** Squirrel.Mac only installs signed updates, so Macs download and swap themselves in, through macUpdate.ts. */
const installsItself = () => process.platform !== 'darwin'

/** electron-builder leaves this file in the .deb, and AppImages announce themselves. */
const isDeb = () => process.platform === 'linux' && !process.env.APPIMAGE && existsSync(join(process.resourcesPath, 'package-type'))

function canUpdate(): boolean {
  if (isPrivate) return false
  if (testFeed()) return true
  if (!app.isPackaged) return false
  return process.platform !== 'linux' || !!process.env.APPIMAGE || isDeb()
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error ?? ''))
const badChecksum = (error: unknown) => /sha512|checksum/i.test(messageOf(error))

export function updateError(error: unknown): string {
  const message = messageOf(error)
  if (/stalled/i.test(message)) return 'The download stopped moving.'
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNRE|EAI_AGAIN|socket hang up|aborted/i.test(message)) return "Couldn't reach the update server."
  if (/\b404\b|Cannot find .*\.yml/i.test(message)) return 'No release has been published yet.'
  if (badChecksum(error)) return "The download didn't match its checksum, so it was thrown away."
  if (/EACCES|EPERM|EROFS/.test(message)) return "scTerra isn't allowed to replace its own file. Move it to a folder you own, or install the new version by hand."
  return "Couldn't finish updating."
}

/** Checks the public release repo, which needs no token. Only installers live there. */
export class UpdateService {
  private current: UpdateState = { ...IDLE_UPDATE, supported: canUpdate(), installsOnQuit: canUpdate() && !isDeb() }
  private firstCheck: ReturnType<typeof setTimeout> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private stallTimer: ReturnType<typeof setTimeout> | undefined
  private download: CancellationToken | null = null
  /** How many times in a row this round has failed. */
  private failures = 0
  private wired = false
  /** A Mac's next version, unpacked and waiting for the app to quit. */
  private stagedMac: string | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly onChange: (state: UpdateState) => void,
    private readonly kv?: { get(key: string): unknown; set(key: string, value: unknown): void; delete(key: string): void }
  ) {
    this.current = { ...this.current, whatsNew: this.noteVersion() }
  }

  /** A version that arrived since the last run, and has notes, is shown once. */
  private noteVersion(): string | null {
    if (!this.kv) return null
    const now = app.getVersion()
    // Versions up to 0.5.1 didn't record themselves, so a profile with a saved session but no version came from one.
    const last = this.kv.get(LAST_VERSION_KEY) ?? (this.kv.get('session') !== undefined ? 'older' : undefined)
    if (typeof last === 'string' && last !== now && WHATS_NEW.some((notes) => notes.version === now)) this.kv.set(WHATS_NEW_KEY, now)
    this.kv.set(LAST_VERSION_KEY, now)
    return this.kv.get(WHATS_NEW_KEY) === now ? now : null
  }

  /** The newest published release before this one. Null if there isn't one, or it couldn't be found out. */
  async previousVersion(): Promise<string | null> {
    if (!this.current.supported) return null
    const url = testFeed() ? process.env.SCB_RELEASES_API_URL : RELEASES_API_URL
    if (!url) return null
    try {
      const response = await net.fetch(url, { headers: { accept: 'application/vnd.github+json' } })
      return response.ok ? previousRelease(await response.json(), app.getVersion()) : null
    } catch {
      return null
    }
  }

  /**
   * Downloads an older release in place of the newest, for when this one misbehaves. Automatic
   * updates are turned off, or the next start would bring the newer version straight back.
   */
  async rollback(version: string): Promise<UpdateState> {
    if (!this.current.supported || !/^\d+\.\d+\.\d+$/.test(version) || compareVersions(version, app.getVersion()) >= 0) return this.current
    if (['checking', 'available', 'downloading', 'installing'].includes(this.current.phase)) return this.current
    this.wire()
    this.settings.set({ autoUpdate: false })
    clearTimeout(this.retryTimer)
    this.failures = 0
    autoUpdater.allowDowngrade = true
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeed() ?? releaseDownloadBase(version) })
    await this.attempt()
    return this.current
  }

  /** The notes have been read, or put away. */
  seenWhatsNew(): void {
    this.kv?.delete(WHATS_NEW_KEY)
    if (this.current.whatsNew) this.set({ whatsNew: null })
  }

  state(): UpdateState {
    return this.current
  }

  start(): void {
    if (!this.current.supported) return
    this.firstCheck = setTimeout(() => {
      if (this.settings.get().autoUpdate) void this.check()
    }, Number(process.env.SCB_UPDATE_DELAY) || FIRST_CHECK_MS)
    this.timer = setInterval(() => {
      if (this.settings.get().autoUpdate) void this.check()
    }, CHECK_EVERY_MS)
  }

  /** A fresh round, from the timer or Check now: it also cancels a retry that was waiting. */
  async check(): Promise<UpdateState> {
    if (!this.current.supported || ['checking', 'available', 'downloading', 'ready', 'installing'].includes(this.current.phase)) return this.current
    clearTimeout(this.retryTimer)
    this.failures = 0
    await this.attempt()
    return this.current
  }

  install(): void {
    if (this.current.phase === 'manual') void shell.openExternal(RELEASES_URL)
    if (this.current.phase !== 'ready') return
    this.set({ phase: 'installing' })
    setTimeout(() => {
      if (this.stagedMac) {
        swapOnExit(this.stagedMac, true)
        this.stagedMac = null
        app.quit()
        return
      }
      // isSilent is for Windows, and the second argument reopens the browser afterwards.
      // A failure here comes back through the error event, which takes the update screen down again.
      autoUpdater.quitAndInstall(true, true)
    }, INSTALL_PAINT_MS)
  }

  stop(): void {
    clearTimeout(this.firstCheck)
    clearInterval(this.timer)
    clearTimeout(this.retryTimer)
    clearTimeout(this.stallTimer)
    this.download?.cancel()
  }

  private async attempt(): Promise<void> {
    this.wire()
    // Downloads are started here rather than by electron-updater, so they can be watched, cancelled and retried.
    autoUpdater.autoDownload = false
    this.set({ phase: 'checking', error: null })
    let available = false
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result) return this.set({ phase: 'idle' })
      available = result.isUpdateAvailable
    } catch (error) {
      return this.fail(error)
    }
    if (!available) {
      this.failures = 0
      return
    }
    // Macs stage their own download from the update-available event.
    if (installsItself()) await this.downloadUpdate()
  }

  private async downloadUpdate(): Promise<void> {
    const token = new CancellationToken()
    this.download = token
    this.watchStall()
    try {
      await autoUpdater.downloadUpdate(token)
      this.failures = 0
    } catch (error) {
      if (this.download === token) this.fail(token.cancelled ? new Error('stalled') : error)
    } finally {
      clearTimeout(this.stallTimer)
      if (this.download === token) this.download = null
    }
  }

  /** Restarts whenever the download moves; if it doesn't for a while, it's cancelled and tried again. */
  private watchStall(): void {
    clearTimeout(this.stallTimer)
    this.stallTimer = setTimeout(() => this.download?.cancel(), Number(process.env.SCB_E2E && process.env.SCB_UPDATE_STALL_MS) || STALL_MS)
  }

  private fail(error: unknown): void {
    // A damaged patch is the usual cause, so the next try fetches the whole file.
    if (badChecksum(error)) autoUpdater.disableDifferentialDownload = true
    const reason = updateError(error)
    if (this.failures < RETRY_DELAYS_MS.length) {
      const wait = delay(this.failures++)
      this.set({ phase: 'error', error: `${reason} Trying again shortly.` })
      clearTimeout(this.retryTimer)
      this.retryTimer = setTimeout(() => void this.attempt(), wait)
      return
    }
    this.set({ phase: 'error', error: reason })
  }

  private wire(): void {
    if (this.wired) return
    this.wired = true
    autoUpdater.logger = null
    // Installing a .deb asks for a password, so that only happens when someone presses the button.
    autoUpdater.autoInstallOnAppQuit = !isDeb()
    const feed = testFeed()
    if (feed) {
      autoUpdater.forceDevUpdateConfig = true
      autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    }
    autoUpdater.on('update-available', (info) => {
      if (installsItself()) this.set({ phase: 'available', version: info.version, percent: null })
      else void this.updateMac(info)
    })
    // As on other systems, an update that's ready goes in when the app next closes.
    if (!installsItself()) {
      app.once('will-quit', () => {
        if (this.stagedMac) swapOnExit(this.stagedMac, false)
      })
    }
    autoUpdater.on('update-not-available', () => this.set({ phase: 'current', version: null, percent: null }))
    autoUpdater.on('download-progress', ({ percent }) => {
      this.watchStall()
      this.set({ phase: 'downloading', percent: Math.round(percent) })
    })
    autoUpdater.on('update-downloaded', ({ version }) => this.set({ phase: 'ready', version, percent: 100 }))
    // Checks and downloads report their errors through their promises; only installing has no other way.
    autoUpdater.on('error', (error) => {
      if (this.current.phase === 'installing') this.set({ phase: 'error', error: updateError(error) })
    })
  }

  /** Where the app can't replace itself, or the release has no build for this kind of Mac, it points at the release. */
  private async updateMac({ version, files }: UpdateInfo): Promise<void> {
    const file = zipForArch(files, process.arch)
    if (!file || !canReplaceApp()) {
      this.set({ phase: 'manual', version })
      return
    }
    this.set({ phase: 'available', version })
    try {
      this.stagedMac = await stageUpdate(version, file, (percent) => this.set({ phase: 'downloading', percent }), testFeed())
      this.failures = 0
      this.set({ phase: 'ready', version, percent: 100 })
    } catch (error) {
      this.fail(error)
    }
  }

  private set(patch: Partial<UpdateState>): void {
    this.current = { ...this.current, ...patch }
    this.onChange(this.current)
  }
}
