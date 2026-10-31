import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { INTERNAL_COMMAND_CHANNELS, type AssistantEvent, type InternalBridge } from '@scbrowser/shared'

declare const location: { protocol: string }

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
