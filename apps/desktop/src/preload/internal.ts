import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { INTERNAL_COMMAND_CHANNELS, SIGN_IN_HOSTS, type AssistantEvent, type InternalBridge } from '@scbrowser/shared'

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
