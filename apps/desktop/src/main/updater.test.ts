import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@scbrowser/shared'

const updater = vi.hoisted(() => {
  // A stand-in for electron-updater's autoUpdater, with checks and downloads the tests script.
  const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events')
  class Token {
    cancelled = false
    private listeners: (() => void)[] = []
    cancel() {
      this.cancelled = true
      this.listeners.forEach((listener) => listener())
    }
    onCancel(listener: () => void) {
      this.listeners.push(listener)
    }
  }
  const emitter = Object.assign(new Emitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    disableDifferentialDownload: false,
    forceDevUpdateConfig: false,
    logger: null as unknown,
    setFeedURL: () => undefined,
    quitAndInstall: (): void => undefined,
    checkForUpdates: async (): Promise<unknown> => null,
    downloadUpdate: async (_token: Token): Promise<string[]> => []
  })
  return { emitter, Token }
})

vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.5.3', quit: () => undefined, once: () => undefined }, shell: { openExternal: async () => undefined } }))
vi.mock('electron-updater', () => ({ autoUpdater: updater.emitter, CancellationToken: updater.Token }))
vi.mock('./macUpdate', () => ({ canReplaceApp: () => true, stageUpdate: async () => '', swapOnExit: () => undefined, zipForArch: () => null }))
vi.mock('./private', () => ({ isPrivate: false }))

import { RETRY_DELAYS_MS, STALL_MS, UpdateService, updateError } from './updater'

const auto = updater.emitter
const settings = { get: () => ({ autoUpdate: true }) } as never
const platform = process.platform

function service() {
  const states: UpdateState[] = []
  const updates = new UpdateService(settings, (state) => states.push(state))
  return { updates, states, last: () => states.at(-1)! }
}

const available = (version = '9.9.9') => async () => {
  auto.emit('update-available', { version })
  return { isUpdateAvailable: true }
}

describe('UpdateService', () => {
  const env = { ...process.env }
  beforeEach(() => {
    vi.useFakeTimers()
    // The test feed makes this copy count as able to update.
    process.env.SCB_E2E = '1'
    process.env.SCB_UPDATE_URL = 'http://127.0.0.1:9/'
    Object.assign(process, { resourcesPath: '/nonexistent' })
    // These are the Linux and Windows path; Macs stage their own download, which macUpdate.test.ts covers.
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    auto.removeAllListeners()
    auto.disableDifferentialDownload = false
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    vi.useRealTimers()
    process.env = { ...env }
  })

  it('tries a failed check again by itself, and then succeeds', async () => {
    const { updates, last } = service()
    let calls = 0
    auto.checkForUpdates = async () => {
      if (++calls === 1) throw new Error('net::ERR_CONNECTION_RESET')
      auto.emit('update-not-available')
      return { isUpdateAvailable: false }
    }
    await updates.check()
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining('Trying again') })
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!)
    expect(calls).toBe(2)
    expect(last().phase).toBe('current')
    updates.stop()
  })

  it('gives up after its retries and says why', async () => {
    const { updates, last } = service()
    let calls = 0
    auto.checkForUpdates = async () => {
      calls++
      throw new Error('getaddrinfo ENOTFOUND github.com')
    }
    await updates.check()
    for (const wait of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(wait)
    expect(calls).toBe(RETRY_DELAYS_MS.length + 1)
    expect(last()).toEqual(expect.objectContaining({ phase: 'error', error: "Couldn't reach the update server." }))
    // Check now starts a whole new round.
    await updates.check()
    expect(calls).toBe(RETRY_DELAYS_MS.length + 2)
    updates.stop()
  })

  it('downloads the whole file again after a checksum failure', async () => {
    const { updates, last } = service()
    auto.checkForUpdates = available()
    let downloads = 0
    auto.downloadUpdate = async () => {
      if (++downloads === 1) throw new Error('sha512 checksum mismatch')
      expect(auto.disableDifferentialDownload).toBe(true)
      auto.emit('update-downloaded', { version: '9.9.9' })
      return []
    }
    await updates.check()
    expect(last().phase).toBe('error')
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!)
    expect(last()).toMatchObject({ phase: 'ready', version: '9.9.9' })
    updates.stop()
  })

  it('cancels a download that stops moving and starts it again', async () => {
    const { updates, last } = service()
    auto.checkForUpdates = available()
    let downloads = 0
    auto.downloadUpdate = (token) => {
      if (++downloads === 1) {
        auto.emit('download-progress', { percent: 10 })
        return new Promise((_, reject) => token.onCancel(() => reject(new Error('cancelled'))))
      }
      auto.emit('update-downloaded', { version: '9.9.9' })
      return Promise.resolve([])
    }
    const checking = updates.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(last()).toMatchObject({ phase: 'downloading', percent: 10 })
    // While stuck, Check now does nothing, which is why the watchdog has to step in.
    await vi.advanceTimersByTimeAsync(STALL_MS)
    await checking
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining('stopped moving') })
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!)
    expect(downloads).toBe(2)
    expect(last().phase).toBe('ready')
    updates.stop()
  })

  it('takes the update screen down when installing fails', async () => {
    const { updates, last } = service()
    auto.checkForUpdates = available()
    auto.downloadUpdate = async () => {
      auto.emit('update-downloaded', { version: '9.9.9' })
      return []
    }
    auto.quitAndInstall = () => void auto.emit('error', new Error('EACCES: permission denied, unlink'))
    await updates.check()
    updates.install()
    expect(last().phase).toBe('installing')
    await vi.advanceTimersByTimeAsync(1000)
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining('replace its own file') })
    updates.stop()
  })

  it('names the usual failures', () => {
    expect(updateError(new Error('HttpError: 404'))).toBe('No release has been published yet.')
    expect(updateError(new Error('Cannot find latest-linux.yml in the latest release artifacts'))).toBe('No release has been published yet.')
    expect(updateError(new Error('net::ERR_TIMED_OUT'))).toBe("Couldn't reach the update server.")
  })

  it('shows what is new once after an update, including from versions that never recorded themselves', () => {
    const store = (entries: Record<string, unknown>) => {
      const data = new Map(Object.entries(entries))
      return { get: (key: string) => data.get(key), set: (key: string, value: unknown) => void data.set(key, value), delete: (key: string) => void data.delete(key) }
    }
    expect(new UpdateService(settings, () => undefined, store({})).state().whatsNew).toBeNull()
    expect(new UpdateService(settings, () => undefined, store({ 'app:last-version': '0.5.3' })).state().whatsNew).toBeNull()
    expect(new UpdateService(settings, () => undefined, store({ 'app:last-version': '0.5.1' })).state().whatsNew).toBe('0.5.3')
    const old = store({ session: { tabs: [] } })
    const first = new UpdateService(settings, () => undefined, old)
    expect(first.state().whatsNew).toBe('0.5.3')
    first.seenWhatsNew()
    expect(new UpdateService(settings, () => undefined, old).state().whatsNew).toBeNull()
  })
})
