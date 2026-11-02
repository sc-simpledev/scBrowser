import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface Harness {
  app: ElectronApplication
  chrome: Page
  profile: string
  overlay: () => Promise<Page>
  /** The tab whose URL contains `fragment`. */
  page: (fragment: string) => Promise<Page>
  close: () => Promise<void>
}

export const newProfile = () => mkdtempSync(join(tmpdir(), 'scb-e2e-'))

/** Launches the built app, with a fresh profile unless one is passed in. */
export async function launch(profile = newProfile(), switches: string[] = [], extraEnv: Record<string, string> = {}): Promise<Harness> {
  // SCB_E2E_EXECUTABLE points the suite at a packaged build instead of the dev output.
  const executablePath = process.env.SCB_E2E_EXECUTABLE
  const app = await electron.launch({
    ...(executablePath ? { executablePath, args: switches } : { args: [...switches, resolve(__dirname, '../apps/desktop')] }),
    env: { ...process.env, SCB_USER_DATA_DIR: profile, SCB_E2E: '1', SCB_FILTERS: '/tracker.js\n##.ad-slot', SCDELTA_AI_URL: process.env.SCDELTA_AI_URL ?? 'off', ...extraEnv }
  })
  app.process().stderr?.on('data', (data: Buffer) => {
    if (String(data).includes('Uncaught exception')) console.error(String(data))
  })
  const find = async (matches: (page: Page) => boolean) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const page = app.windows().find(matches)
      if (page) return page
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Page not found')
  }
  const chrome = await find((p) => p.url().includes('/renderer/index.html'))
  await chrome.getByRole('tab').first().waitFor()
  return {
    app,
    chrome,
    profile,
    overlay: () => find((p) => p.url().includes('overlay.html')),
    page: (fragment) => find((p) => p.url().includes(fragment)),
    close: () => app.close()
  }
}

/** Builds a small valid one-page PDF. */
function pdfWith(text: string): Buffer {
  const stream = text ? `BT /F1 18 Tf 72 720 Td (${text}) Tj ET` : ''
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const offset = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

export interface Site {
  url: (path: string) => string
  server: Server
}

/** A local site so tests don't depend on the network. Values are full HTML bodies. */
export async function serveSite(pages: Record<string, string>): Promise<Site> {
  const server = createServer((req, res) => {
    if (req.url === '/file.txt') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="file.txt"' })
      res.end('downloaded content')
      return
    }
    if (req.url?.endsWith('.pdf')) {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end(pdfWith(req.url.includes('empty') ? '' : 'The launch code word is marigold.'))
      return
    }
    if (req.url === '/generate_204') {
      res.writeHead(204)
      res.end()
      return
    }
    const body = pages[req.url ?? '']
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' })
    res.end(body ?? 'not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: (path) => `http://127.0.0.1:${port}${path}`, server }
}

export const titled = (title: string, body = '') => `<!doctype html><title>${title}</title><h1>${title}</h1>${body}`

export const omnibox = (h: Harness) => h.chrome.getByRole('combobox', { name: 'Search or enter address' })

export async function go(h: Harness, address: string) {
  await omnibox(h).click()
  await omnibox(h).fill(address)
  await omnibox(h).press('Enter')
}

export const activeTab = (h: Harness) => h.chrome.getByRole('tab', { selected: true })

/** Sends a real key press to the active tab, as the OS would; Playwright's bypass main-process hooks. */
export const shortcut = (h: Harness, key: string, modifiers: ('control' | 'shift')[] = ['control']) =>
  h.app.evaluate(
    ({ BrowserWindow, webContents }, { keyCode, modifiers }) => {
      // A window behind others has nothing focused; the browser UI still takes shortcuts.
      const target =
        webContents.getAllWebContents().find((c) => c.isFocused()) ??
        webContents.getFocusedWebContents() ??
        BrowserWindow.getAllWindows()[0]?.webContents
      target?.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      target?.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    },
    { keyCode: key, modifiers }
  )

export const setSetting = (h: Harness, patch: Record<string, unknown>) =>
  h.chrome.evaluate((p) => window.scb.invoke('settings:set', p), patch)

declare global {
  interface Window {
    scb: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
  }
}
