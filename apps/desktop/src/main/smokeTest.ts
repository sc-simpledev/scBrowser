import { app, webContents, type WebContents } from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindowHandle } from './browserCore'

/** Started with this, scTerra opens one window, checks that it drew, and quits: for testing a built installer. */
export const SMOKE_TEST_FLAG = '--smoke-test'
const LIMIT_MS = 60_000

export const isSmokeTest = (argv: string[]) => argv.includes(SMOKE_TEST_FLAG)

/** A throwaway profile, so a check never touches anyone's own, and nothing it does is sent anywhere. */
export function prepareSmokeTest(): void {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'scterra-smoke-')))
  process.env.SCTERRA_AI_URL = 'off'
}

const loaded = (contents: WebContents | undefined) => !!contents && !contents.isDestroyed() && !contents.isLoading() && contents.getURL() !== ''

/**
 * Passes once the browser's own interface and the first tab have both finished loading, with no
 * process gone on the way. Prints what it found and quits with 0, or 1 on a failure or after a minute.
 */
export function runSmokeTest(handle: BrowserWindowHandle): void {
  const started = Date.now()
  let failure: string | null = null
  app.on('render-process-gone', (_event, contents, { reason }) => {
    if (reason !== 'clean-exit') failure = `A page process stopped (${reason}) at ${contents.getURL() || 'a blank page'}`
  })
  app.on('child-process-gone', (_event, { type, reason }) => {
    if (reason !== 'clean-exit' && reason !== 'killed') failure = `The ${type} process stopped (${reason})`
  })
  const finish = (code: number, message: string) => {
    process.stdout.write(`${message}\n`)
    app.exit(code)
  }
  const check = () => {
    if (failure) return finish(1, `scTerra ${app.getVersion()} smoke test failed: ${failure}`)
    const ui = webContents.getAllWebContents().find((contents) => /\/index\.html($|[?#])/.test(contents.getURL()))
    const tab = handle.tabs.active ? handle.tabs.contentsFor(handle.tabs.active.id) : undefined
    if (loaded(ui) && loaded(tab)) return finish(0, `scTerra ${app.getVersion()} smoke test passed in ${Date.now() - started} ms: ${tab!.getURL()}`)
    if (Date.now() - started > LIMIT_MS) return finish(1, `scTerra ${app.getVersion()} smoke test failed: ${loaded(ui) ? 'the first tab' : "the browser's interface"} didn't finish loading within a minute`)
    setTimeout(check, 500)
  }
  setTimeout(check, 500)
}
