import type { Input, WebContents } from 'electron'
import type { BrowserActions } from './actions'

/**
 * Browser-wide keyboard shortcuts. They are handled in the main process so they work
 * whether focus is in the chrome UI or inside a web page.
 */
export function handleShortcut(input: Input, actions: BrowserActions): boolean {
  if (input.type !== 'keyDown') return false
  const { tabs } = actions
  const key = input.key.toLowerCase()
  const mod = input.control
  const active = tabs.active

  const run = (action: () => void) => {
    action()
    return true
  }
  const onActive = (action: (id: number) => void) => run(() => active && action(active.id))

  if (mod && !input.shift && key === 't') return run(() => tabs.create())
  if (mod && input.shift && key === 't') return run(() => tabs.reopenClosed())
  if (mod && key === 'w') return onActive((id) => tabs.close(id))
  if ((mod && key === 'l') || key === 'f6' || (input.alt && key === 'd')) return run(actions.focusOmnibox)
  if ((mod && key === 'r') || key === 'f5') return onActive((id) => tabs.reload(id, input.shift || mod && key === 'f5'))
  if (input.alt && key === 'arrowleft') return onActive((id) => tabs.back(id))
  if (input.alt && key === 'arrowright') return onActive((id) => tabs.forward(id))
  if (mod && key === 'tab') return run(() => tabs.activateRelative(input.shift ? -1 : 1))
  if (mod && (key === 'pagedown' || key === 'pageup')) return run(() => tabs.activateRelative(key === 'pagedown' ? 1 : -1))
  if (mod && /^[1-9]$/.test(key)) return run(() => tabs.activateIndex(Number(key)))
  if (key === 'f12' || (mod && input.shift && key === 'i')) return onActive((id) => tabs.toggleDevTools(id))
  if (key === 'f11') return run(actions.toggleFullscreen)
  if (mod && !input.shift && key === 'f') return run(actions.openFind)
  if (mod && !input.shift && key === 'd') return run(actions.toggleBookmark)
  if (mod && !input.shift && key === 'k') return run(actions.togglePalette)
  if (key === 'f9') return run(actions.toggleReader)
  if (mod && input.shift && key === 's') return run(actions.screenshot)
  if (mod && input.shift && key === 'a') return run(actions.toggleAssistant)
  if (mod && input.shift && key === 'b') return run(actions.toggleBookmarksBar)
  if (mod && input.shift && key === 'o') return run(() => actions.openPage('bookmarks'))
  if (mod && !input.shift && key === 'h') return run(() => actions.openPage('history'))
  if (mod && !input.shift && key === 'j') return run(() => actions.openPage('downloads'))
  if (mod && !input.shift && key === 'p') return onActive((id) => tabs.print(id))
  if (mod && (key === '=' || key === '+')) return onActive((id) => tabs.zoomBy(id, 1))
  if (mod && key === '-') return onActive((id) => tabs.zoomBy(id, -1))
  if (mod && key === '0') return onActive((id) => tabs.setZoom(id, 1))
  if (mod && !input.shift && key === 'q') return run(actions.quit)
  return false
}

export function attachShortcuts(contents: WebContents, actions: BrowserActions): void {
  contents.on('before-input-event', (event, input) => {
    if (handleShortcut(input, actions)) event.preventDefault()
  })
}
