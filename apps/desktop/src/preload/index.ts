import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { COMMAND_CHANNELS, EVENT_CHANNELS, type ChromeBridge } from '@scbrowser/shared'

const commands = new Set<string>(COMMAND_CHANNELS)
const events = new Set<string>(EVENT_CHANNELS)

const bridge: ChromeBridge = {
  invoke: (channel, ...args) => {
    if (!commands.has(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel, listener) => {
    if (!events.has(channel)) throw new Error(`Unknown channel ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  platform: process.platform as ChromeBridge['platform']
}

contextBridge.exposeInMainWorld('scb', bridge)
