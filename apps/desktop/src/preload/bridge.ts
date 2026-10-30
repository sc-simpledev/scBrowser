import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Bridge } from '@scbrowser/shared'

/** Builds a typed bridge that can only reach the listed channels. */
export function createBridge<Commands extends { [K in keyof Commands]: (...args: never[]) => unknown }, Events>(
  commandChannels: readonly string[],
  eventChannels: readonly string[]
): Bridge<Commands, Events> {
  const commands = new Set(commandChannels)
  const events = new Set(eventChannels)
  return {
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
    platform: process.platform as Bridge<Commands, Events>['platform']
  }
}
