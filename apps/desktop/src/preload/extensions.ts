import { contextBridge, ipcRenderer } from 'electron'
import { SIDE_PANEL_CHANNEL } from '@scbrowser/shared'

declare const location: { protocol: string }
declare const process: { type: string }

type Call = (method: string, ...args: unknown[]) => Promise<unknown>

/**
 * Chrome's `chrome.sidePanel`, which neither Electron nor the extensions library provides. Without
 * it, an extension's background script stops at its first call, taking the rest of its setup too.
 * This has to run before the library's page script, which freezes `chrome`.
 */
function addSidePanelApi() {
  const scope = globalThis as unknown as { chrome?: Record<string, never> & { runtime?: { getManifest?: () => { permissions?: string[] } } }; scbSidePanel?: Call }
  const call = scope.scbSidePanel!
  delete scope.scbSidePanel
  const { chrome } = scope
  if (!chrome?.runtime?.getManifest?.().permissions?.includes('sidePanel') || chrome.sidePanel) return
  const method = (name: string) => (...args: unknown[]) => {
    const callback = typeof args.at(-1) === 'function' ? (args.pop() as (result: unknown) => void) : undefined
    const result = call(name, ...args)
    if (callback) void result.then(callback, () => callback(undefined))
    return result
  }
  // Nothing reports these yet, but an extension listening for them shouldn't fail.
  const quietEvent = () => ({ addListener() {}, removeListener() {}, hasListener: () => false })
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
      onOpened: quietEvent(),
      onClosed: quietEvent()
    }
  })
}

if (process.type === 'service-worker' || location.protocol === 'chrome-extension:') {
  const call: Call = (method, ...args) => ipcRenderer.invoke(SIDE_PANEL_CHANNEL, method, ...args)
  contextBridge.exposeInMainWorld('scbSidePanel', call)
  contextBridge.executeInMainWorld({ func: addSidePanelApi })
}
