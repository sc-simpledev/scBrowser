import { contextBridge, ipcRenderer } from 'electron'
import { SIDE_PANEL_CHANNEL, SIDE_PANEL_EVENT } from '@scbrowser/shared'

declare const location: { protocol: string }
declare const process: { type: string }

type Call = (method: string, ...args: unknown[]) => Promise<unknown>
type Listen = (listener: (name: 'opened' | 'closed', info: unknown) => void) => void

/**
 * Chrome's `chrome.sidePanel`, which neither Electron nor the extensions library provides. Without
 * it, an extension's background script stops at its first call, taking the rest of its setup too.
 * This has to run before the library's page script, which freezes `chrome`.
 */
function addSidePanelApi() {
  const scope = globalThis as unknown as { chrome?: Record<string, never> & { runtime?: { getManifest?: () => { permissions?: string[] } } }; scbSidePanel?: Call; scbSidePanelEvents?: Listen }
  const call = scope.scbSidePanel!
  const listen = scope.scbSidePanelEvents!
  delete scope.scbSidePanel
  delete scope.scbSidePanelEvents
  const { chrome } = scope
  if (!chrome?.runtime?.getManifest?.().permissions?.includes('sidePanel') || chrome.sidePanel) return
  const method = (name: string) => (...args: unknown[]) => {
    const callback = typeof args.at(-1) === 'function' ? (args.pop() as (result: unknown) => void) : undefined
    const result = call(name, ...args)
    if (callback) void result.then(callback, () => callback(undefined))
    return result
  }
  const listeners = { opened: new Set<(info: unknown) => void>(), closed: new Set<(info: unknown) => void>() }
  listen((name, info) => {
    for (const listener of listeners[name]) {
      try {
        listener(info)
      } catch (error) {
        console.error(error)
      }
    }
  })
  const event = (name: 'opened' | 'closed') => ({
    addListener: (listener: (info: unknown) => void) => void listeners[name].add(listener),
    removeListener: (listener: (info: unknown) => void) => void listeners[name].delete(listener),
    hasListener: (listener: (info: unknown) => void) => listeners[name].has(listener),
    hasListeners: () => listeners[name].size > 0
  })
  Object.defineProperty(chrome, 'sidePanel', {
    enumerable: true,
    configurable: true,
    value: {
      open: method('open'),
      close: method('close'),
      setOptions: method('setOptions'),
      getOptions: method('getOptions'),
      setPanelBehavior: method('setPanelBehavior'),
      getPanelBehavior: method('getPanelBehavior'),
      getLayout: async () => ({ side: 'right' }),
      onOpened: event('opened'),
      onClosed: event('closed')
    }
  })
}

if (process.type === 'service-worker' || location.protocol === 'chrome-extension:') {
  const call: Call = (method, ...args) => ipcRenderer.invoke(SIDE_PANEL_CHANNEL, method, ...args)
  const listen: Listen = (listener) => void ipcRenderer.on(SIDE_PANEL_EVENT, (_event, name: 'opened' | 'closed', info: unknown) => listener(name, info))
  contextBridge.exposeInMainWorld('scbSidePanel', call)
  contextBridge.exposeInMainWorld('scbSidePanelEvents', listen)
  contextBridge.executeInMainWorld({ func: addSidePanelApi })
}
