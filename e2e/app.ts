import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface Harness {
  app: ElectronApplication
  chrome: Page
  overlay: () => Promise<Page>
  close: () => Promise<void>
}

/** Launches the built app with a fresh profile. */
export async function launch(): Promise<Harness> {
  const app = await electron.launch({
    args: [resolve(__dirname, '../apps/desktop')],
    env: { ...process.env, SCB_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'scb-e2e-')) }
  })
  const chrome = await app.firstWindow()
  await chrome.getByRole('tab').first().waitFor()
  const overlay = async () => {
    for (;;) {
      const page = app.windows().find((p) => p.url().includes('overlay.html'))
      if (page) return page
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  return { app, chrome, overlay, close: () => app.close() }
}

/** A local site so tests don't depend on the network. */
export async function serveSite(pages: Record<string, string>): Promise<{ url: (path: string) => string; server: Server }> {
  const server = createServer((req, res) => {
    const title = pages[req.url ?? '']
    res.writeHead(title ? 200 : 404, { 'content-type': 'text/html' })
    res.end(title ? `<!doctype html><title>${title}</title><h1>${title}</h1>` : 'not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: (path) => `http://127.0.0.1:${port}${path}`, server }
}
