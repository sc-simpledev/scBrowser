import * as electron from 'electron'
import type { DrmStatus } from '@scbrowser/shared'

/**
 * Widevine, for protected video and music (Netflix, Spotify, Disney+ and the like). scTerra runs on
 * castLabs' Electron for Content Security, whose `components` API installs Google's Widevine module
 * through Chromium's component updater the first time and keeps it up to date after that.
 *
 * On Windows and macOS streaming services also want a production VMP signature on the app, added
 * when it's packaged (scripts/vmp-sign.cjs). Linux has no VMP, so Widevine works there as it is.
 */

/** Startup waits this long at most for Widevine to register, so a restored Netflix tab can play. */
export const DRM_STARTUP_WAIT_MS = 1500

type Components = {
  whenReady(required?: string[]): Promise<{ id: string; status: string; title: string | null; version: string | null }[]>
  status(): Record<string, { status: string; title: string | null; version: string | null }>
  readonly WIDEVINE_CDM_ID: string
}

/** castLabs' build has it; stock Electron (and the tests' stand-ins) don't. */
const componentsApi = (): Components | null => ((electron as unknown as { components?: Components }).components ?? null)

let status: DrmStatus = { state: 'off', version: null, error: null }
let started: Promise<void> | null = null
const listeners = new Set<(status: DrmStatus) => void>()

const set = (next: DrmStatus) => {
  status = next
  for (const listener of listeners) listener(next)
}

/** Why an install failed, in words, from castLabs' error. */
function failureText(error: unknown): string {
  const errors = (error as { errors?: { message?: string }[] } | null)?.errors
  const said = errors?.map((one) => one.message).filter(Boolean).join('; ') || (error instanceof Error ? error.message : '')
  if (/network|offline|connect|resolve|timed? ?out/i.test(said)) return 'Couldn’t download Widevine. It tries again next time scTerra starts with a connection.'
  return said ? `Widevine didn’t install: ${said}` : 'Widevine didn’t install.'
}

/**
 * Registers Widevine, downloading it on the first run. Tests don't fetch it from Google unless
 * SCB_DRM is set. Resolves once it's ready or has failed; never rejects.
 */
export function startDrm(): Promise<void> {
  if (started) return started
  const api = componentsApi()
  if (!api) {
    set({ state: 'unsupported', version: null, error: 'This build of scTerra has no Widevine.' })
    return (started = Promise.resolve())
  }
  if (process.env.SCB_E2E && !process.env.SCB_DRM) {
    set({ state: 'off', version: null, error: 'Not started under tests.' })
    return (started = Promise.resolve())
  }
  const installed = api.status()[api.WIDEVINE_CDM_ID]?.version ?? null
  set({ state: 'starting', version: installed, error: null })
  started = api
    .whenReady([api.WIDEVINE_CDM_ID])
    .then((results) => {
      const widevine = results.find((one) => one.id === api.WIDEVINE_CDM_ID)
      set({ state: 'ready', version: widevine?.version ?? api.status()[api.WIDEVINE_CDM_ID]?.version ?? null, error: null })
    })
    .catch((error: unknown) => set({ state: 'failed', version: api.status()[api.WIDEVINE_CDM_ID]?.version ?? null, error: failureText(error) }))
  return started
}

/**
 * Starts Widevine and waits for it when it's already installed (registering takes a moment, and a
 * restored Netflix tab needs it), never longer than `ms`. A first download carries on in the background.
 */
export function drmStartup(ms = DRM_STARTUP_WAIT_MS): Promise<void> {
  const starting = startDrm()
  if (!status.version || status.state !== 'starting') return Promise.resolve()
  return Promise.race([starting, new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.())])
}

export const drmStatus = (): DrmStatus => status

export function onDrmStatus(listener: (status: DrmStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** For tests: back to before anything started. */
export function resetDrmForTests(): void {
  started = null
  status = { state: 'off', version: null, error: null }
  listeners.clear()
}
