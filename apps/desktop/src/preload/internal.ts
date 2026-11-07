import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { INTERNAL_COMMAND_CHANNELS, SIGN_IN_HOSTS, type AssistantEvent, type CoderEvent, type InternalBridge } from '@scbrowser/shared'

declare const location: { protocol: string; hostname: string }
declare const navigator: { userAgent: string }
declare const process: { versions: Record<string, string> }

// This preload runs in every tab, but websites get nothing: the bridge exists only on
// sc:// pages, and the main process re-checks the calling frame on each call.
if (location.protocol === 'sc:') {
  const channels = new Set<string>(INTERNAL_COMMAND_CHANNELS)
  const bridge: InternalBridge = {
    invoke: (channel, ...args) => {
      if (!channels.has(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`))
      return ipcRenderer.invoke('internal:call', channel, ...args)
    },
    onAssistantEvent: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: AssistantEvent) => listener(payload)
      ipcRenderer.on('ai:event', wrapped)
      return () => ipcRenderer.removeListener('ai:event', wrapped)
    },
    onCoderEvent: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: CoderEvent) => listener(payload)
      ipcRenderer.on('coder:event', wrapped)
      return () => ipcRenderer.removeListener('coder:event', wrapped)
    }
  }
  contextBridge.exposeInMainWorld('scbInternal', bridge)
}

// Google's sign-in pages check that what scripts read matches the request's header. This runs
// before their scripts, and can't disturb a navigation as changing the tab's own identity would.
// signin.test is the tests' stand-in, a name that can't exist on the internet.
if ((SIGN_IN_HOSTS as readonly string[]).includes(location.hostname) || location.hostname === 'signin.test') {
  contextBridge.executeInMainWorld({
    func: (userAgent: string) => {
      for (const name of ['userAgent', 'appVersion']) {
        const value = name === 'userAgent' ? userAgent : userAgent.replace(/^Mozilla\//, '')
        Object.defineProperty(Navigator.prototype, name, { get: () => value, configurable: true })
      }
    },
    args: [navigator.userAgent.replace(' Safari/', ` Electron/${process.versions.electron} Safari/`)]
  })
}

// The Chrome Web Store shows "Switch to Chrome" unless the browser's brands include Google Chrome,
// which Electron's never do (renaming the words on the page doesn't help). Only the store is told
// this, and the request headers say the same, from `googleSignIn.ts`.
if (location.hostname === 'chromewebstore.google.com') {
  contextBridge.executeInMainWorld({
    func: (major: string, full: string) => {
      const brands = [
        { brand: 'Chromium', version: major },
        { brand: 'Google Chrome', version: major },
        { brand: 'Not_A Brand', version: '24' }
      ]
      const fullVersionList = brands.map(({ brand }) => ({ brand, version: brand === 'Not_A Brand' ? '24.0.0.0' : full }))
      const nav = navigator as unknown as { userAgentData?: { platform: string; getHighEntropyValues: (hints: string[]) => Promise<Record<string, unknown>> } }
      const real = nav.userAgentData
      const data = {
        brands,
        mobile: false,
        platform: real?.platform ?? '',
        getHighEntropyValues: async (hints: string[]) => ({ ...(real ? await real.getHighEntropyValues(hints) : {}), brands, mobile: false, fullVersionList, uaFullVersion: full }),
        toJSON: () => ({ brands, mobile: false, platform: real?.platform ?? '' })
      }
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => data, configurable: true })
    },
    args: [process.versions.chrome!.split('.')[0]!, process.versions.chrome!]
  })
}
