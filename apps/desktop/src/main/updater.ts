import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IDLE_UPDATE, RELEASES_URL, type UpdateState } from '@scbrowser/shared'
import { isPrivate } from './private'
import type { SettingsStore } from './settings'

const FIRST_CHECK_MS = 30_000
const CHECK_EVERY_MS = 4 * 60 * 60_000

/** Tests serve a release from this computer. */
const testFeed = () => (process.env.SCB_E2E ? process.env.SCB_UPDATE_URL : undefined)

/** Macs only install signed updates, so until there's a certificate they're told and pointed at the release. */
const installsItself = () => process.platform !== 'darwin'

/** electron-builder leaves this file in the .deb, and AppImages announce themselves. */
const isDeb = () => process.platform === 'linux' && !process.env.APPIMAGE && existsSync(join(process.resourcesPath, 'package-type'))

function canUpdate(): boolean {
  if (isPrivate) return false
  if (testFeed()) return true
  if (!app.isPackaged) return false
  return process.platform !== 'linux' || !!process.env.APPIMAGE || isDeb()
}

function updateError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNRE/.test(message)) return "Couldn't reach the update server."
  if (/\b404\b/.test(message)) return 'No release has been published yet.'
  if (/sha512|checksum/i.test(message)) return "The download didn't match its checksum, so it was thrown away."
  return "Couldn't finish updating."
}

/** Checks the public release repo, which needs no token. Only installers live there. */
export class UpdateService {
  private current: UpdateState = { ...IDLE_UPDATE, supported: canUpdate() }
  private firstCheck: ReturnType<typeof setTimeout> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private wired = false

  constructor(
    private readonly settings: SettingsStore,
    private readonly onChange: (state: UpdateState) => void
  ) {}

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

  async check(): Promise<UpdateState> {
    if (!this.current.supported || ['checking', 'downloading', 'ready'].includes(this.current.phase)) return this.current
    this.wire()
    autoUpdater.autoDownload = installsItself()
    this.set({ phase: 'checking', error: null })
    await autoUpdater.checkForUpdates().catch((error: unknown) => this.set({ phase: 'error', error: updateError(error) }))
    return this.current
  }

  install(): void {
    if (this.current.phase === 'manual') void shell.openExternal(RELEASES_URL)
    // isSilent is for Windows, and the second argument reopens the browser afterwards.
    if (this.current.phase === 'ready') autoUpdater.quitAndInstall(true, true)
  }

  stop(): void {
    clearTimeout(this.firstCheck)
    clearInterval(this.timer)
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
    autoUpdater.on('update-available', ({ version }) => this.set({ phase: installsItself() ? 'available' : 'manual', version }))
    autoUpdater.on('update-not-available', () => this.set({ phase: 'current', version: null, percent: null }))
    autoUpdater.on('download-progress', ({ percent }) => this.set({ phase: 'downloading', percent: Math.round(percent) }))
    autoUpdater.on('update-downloaded', ({ version }) => this.set({ phase: 'ready', version, percent: 100 }))
    autoUpdater.on('error', (error) => this.set({ phase: 'error', error: updateError(error) }))
  }

  private set(patch: Partial<UpdateState>): void {
    this.current = { ...this.current, ...patch }
    this.onChange(this.current)
  }
}
