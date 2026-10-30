import type { Input, WebContents } from 'electron'
import type { TabManager } from './tabs/TabManager'

interface ShortcutContext {
  tabs: TabManager
  focusOmnibox: () => void
}

const isMod = (input: Input) => (process.platform === 'darwin' ? input.meta : input.control)

/**
 * Browser-wide keyboard shortcuts. They are handled in the main process so they work
 * whether focus is in the chrome UI or inside a web page.
 */
export function handleShortcut(input: Input, { tabs, focusOmnibox }: ShortcutContext): boolean {
  if (input.type !== 'keyDown') return false
  const key = input.key.toLowerCase()
  const mod = isMod(input)
  const active = tabs.active

  if (mod && !input.shift && key === 't') {
    tabs.create()
    return true
  }
  if (mod && input.shift && key === 't') {
    tabs.reopenClosed()
    return true
  }
  if (mod && key === 'w') {
    if (active) tabs.close(active.id)
    return true
  }
  if ((mod && key === 'l') || key === 'f6' || (input.alt && key === 'd')) {
    focusOmnibox()
    return true
  }
  if ((mod && key === 'r') || key === 'f5') {
    if (active) tabs.reload(active.id, input.shift || (mod && key === 'f5'))
    return true
  }
  if (input.alt && key === 'arrowleft') {
    if (active) tabs.back(active.id)
    return true
  }
  if (input.alt && key === 'arrowright') {
    if (active) tabs.forward(active.id)
    return true
  }
  if (mod && key === 'tab') {
    tabs.activateRelative(input.shift ? -1 : 1)
    return true
  }
  if (mod && (key === 'pagedown' || key === 'pageup')) {
    tabs.activateRelative(key === 'pagedown' ? 1 : -1)
    return true
  }
  if (mod && /^[1-9]$/.test(key)) {
    tabs.activateIndex(Number(key))
    return true
  }
  if (key === 'f12' || (mod && input.shift && key === 'i')) {
    if (active) tabs.toggleDevTools(active.id)
    return true
  }
  return false
}

export function attachShortcuts(contents: WebContents, context: ShortcutContext): void {
  contents.on('before-input-event', (event, input) => {
    if (handleShortcut(input, context)) event.preventDefault()
  })
}
