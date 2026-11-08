import type { WebContents } from 'electron'

const MAX_RELOADS = 3
const WINDOW_MS = 60_000

/**
 * The browser UI and overlay come back after their process dies. A process that dies again straight
 * away (a graphics driver that can't draw it, say) would otherwise reload in a loop, so after three
 * crashes in a minute it waits longer each time.
 */
export function reloadAfterCrash(contents: WebContents): void {
  let crashes: number[] = []
  contents.on('render-process-gone', (_event, { reason }) => {
    if (reason === 'clean-exit' || contents.isDestroyed()) return
    const now = Date.now()
    crashes = [...crashes.filter((at) => now - at < WINDOW_MS), now]
    const wait = crashes.length <= MAX_RELOADS ? 0 : Math.min(30_000, 2_000 * 2 ** (crashes.length - MAX_RELOADS))
    console.error(`scTerra: a browser view stopped (${reason}); reloading${wait ? ` in ${wait / 1000} s` : ''}.`)
    setTimeout(() => {
      if (!contents.isDestroyed()) contents.reload()
    }, wait)
  })
}
