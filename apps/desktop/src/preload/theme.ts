import { ipcRenderer, type IpcRendererEvent } from 'electron'

/*
 * scTerra's own pages (its toolbar, popups and sc:// pages) take light or dark from the main process,
 * as `data-theme` on the page's root. Electron 45 on Linux says it's dark when the theme is set to
 * Dark, but pages still see `prefers-color-scheme: light`, so the media query alone left Dark doing
 * nothing. The tokens follow the attribute, and fall back to the media query without it.
 */
// This build has no DOM types, so the page is reached loosely.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function followTheme(): void {
  const page = globalThis as any
  let dark = false
  const apply = () => {
    const root = page.document?.documentElement
    if (root) root.dataset.theme = dark ? 'dark' : 'light'
  }
  try {
    dark = ipcRenderer.sendSync('ui:dark') === true
  } catch {
    dark = false
  }
  apply()
  // This early, the page's root element usually doesn't exist yet: it's set the moment it does, so a
  // dark page never shows a light first frame. The load event is a fallback.
  const document = page.document
  if (document && !document.documentElement && typeof page.MutationObserver === 'function') {
    const watch = new page.MutationObserver(() => {
      if (!document.documentElement) return
      apply()
      watch.disconnect()
    })
    watch.observe(document, { childList: true })
  }
  document?.addEventListener?.('DOMContentLoaded', apply, { once: true })
  ipcRenderer.on('ui:dark', (_event: IpcRendererEvent, value: unknown) => {
    dark = value === true
    apply()
  })
}
