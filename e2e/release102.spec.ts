import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site | null = null
let media: Server | null = null
let mock: AiMock | null = null
let folder = ''

test.afterEach(async () => {
  await h?.close().catch(() => undefined)
  site?.server.close()
  site = null
  media?.close()
  media = null
  if (mock) {
    mock.server.closeAllConnections()
    mock.server.close()
    mock = null
  }
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = ''
})

const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>

/** A second of a quiet tone, as a WAV file. */
function tone(): Buffer {
  const rate = 8000
  const samples = Buffer.alloc(rate * 2)
  for (let i = 0; i < rate; i++) samples.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 3000), i * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + samples.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(samples.length, 40)
  return Buffer.concat([head, samples])
}

/** A page whose audio starts by itself, with sound, or muted and then unmuted by its own script. */
async function player(): Promise<string> {
  const wav = tone()
  media = createServer((req, res) => {
    if (req.url === '/tone.wav') {
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length })
      return void res.end(wav)
    }
    if (req.url?.startsWith('/sneaky')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      return void res.end('<!doctype html><title>Sneaky</title><audio id="a" src="/tone.wav" autoplay muted loop></audio><script>document.getElementById("a").addEventListener("playing", () => setTimeout(() => { document.getElementById("a").muted = false }, 200), { once: true })</script>')
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Player</title><audio id="a" src="/tone.wav" autoplay loop></audio>')
  })
  await new Promise<void>((done) => media!.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(media.address() as AddressInfo).port}/`
}

const paused = (page: Page) => page.evaluate(() => (document.getElementById('a') as HTMLAudioElement).paused)

test('autoplay can be set for one site from the padlock, either way from Settings', async () => {
  const url = await player()
  h = await launch()
  await setSetting(h, { httpsOnly: false, blockAutoplay: false })
  await shortcut(h, 'T')
  await go(h, url)
  await expect(activeTab(h)).toHaveText('Player')
  await expect.poll(async () => paused(await h.page(url))).toBe(false)

  // Held for this site alone, though Settings lets every other site play.
  await h.chrome.getByRole('button', { name: 'Site controls' }).click()
  const overlay = await h.overlay()
  const panel = overlay.getByRole('dialog', { name: 'Controls for 127.0.0.1' })
  await panel.getByRole('button', { name: /^Site settings/ }).click()
  const autoplay = panel.getByRole('switch', { name: 'Autoplay on 127.0.0.1' })
  await expect(autoplay).toHaveAttribute('aria-checked', 'true')
  await autoplay.click()
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('settings:get').then((s: any) => s.siteAutoplay))).toEqual({ '127.0.0.1': 'block' })
  await overlay.keyboard.press('Escape')
  const held = await h.page(url)
  await expect.poll(() => held.evaluate(() => (document.getElementById('a') as HTMLAudioElement | null)?.readyState ?? 0)).toBeGreaterThan(2)
  await held.waitForTimeout(400)
  expect(await paused(held)).toBe(true)

  // With Block autoplay on everywhere, the site can be let through instead, in a tab opened at its address
  // (a link, a bookmark, a restored tab), as Chromium's own policy is fixed when a tab's page view is made.
  await setSetting(h, { blockAutoplay: true, siteAutoplay: { '127.0.0.1': 'allow' } })
  await main((g, address) => g.scbTabs.create(address), `${url}?allowed`)
  await expect.poll(async () => paused(await h.page('?allowed'))).toBe(false)
})

test('with autoplay blocked, muted sound that the page unmutes by itself is held too', async () => {
  const url = await player()
  h = await launch()
  await setSetting(h, { httpsOnly: false, blockAutoplay: true })
  await shortcut(h, 'T')
  await go(h, `${url}sneaky`)
  await expect(activeTab(h)).toHaveText('Sneaky')
  const page = await h.page('/sneaky')
  await expect.poll(() => page.evaluate(() => (document.getElementById('a') as HTMLAudioElement).muted)).toBe(false)
  await page.waitForTimeout(300)
  expect(await paused(page)).toBe(true)
})

test('Ctrl Shift D bookmarks every open page into a new folder', async () => {
  site = await serveSite({ '/one': titled('Page one'), '/two': titled('Page two') })
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/one'))
  await expect(activeTab(h)).toHaveText('Page one')
  await shortcut(h, 'T')
  await go(h, site.url('/two'))
  await expect(activeTab(h)).toHaveText('Page two')
  await shortcut(h, 'D', ['control', 'shift'])
  await expect.poll(() => main((g) => g.scbCore.services.bookmarks.groups().map((group: { name: string }) => group.name))).toHaveLength(1)
  expect(await main((g) => g.scbCore.services.bookmarks.list().map((bookmark: { title: string }) => bookmark.title).sort())).toEqual(['Page one', 'Page two'])
})

test('an address that isn’t one of scTerra’s pages says so in its own style', async () => {
  h = await launch()
  await go(h, 'sc://extensions')
  const page = await h.page('sc://extensions')
  await expect(page.getByRole('heading', { name: 'There’s no page here' })).toBeVisible()
  await expect(page.getByText('sc://extensions')).toBeVisible()
  await page.getByRole('link', { name: 'Settings' }).click()
  await h.page('sc://settings')
})

async function openCode(): Promise<Page> {
  folder = mkdtempSync(join(tmpdir(), 'scb-102-'))
  writeFileSync(join(folder, 'a.txt'), 'one\ntwo\nthree\nfour\n')
  h = await launch()
  mock = await startAiMock()
  await go(h, 'sc://ai')
  const ai = await h.page('sc://ai')
  await ai.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await ai.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await ai.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await ai.getByRole('combobox', { name: 'API format' }).selectOption('openai')
  await ai.getByRole('textbox', { name: 'API key' }).fill('test-key-not-real-12345')
  await ai.getByRole('button', { name: 'Add provider' }).click()
  await expect(ai.getByText('Connected, 1 model available')).toBeVisible()
  await ai.getByRole('combobox', { name: 'Chat model for Mock AI' }).selectOption('mock-model')
  await setSetting(h, { coderFolder: folder, coderMode: 'edits', saveChats: true, coderNotify: false })
  await go(h, 'sc://assistant/?mode=code')
  return h.page('sc://assistant')
}

const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``

test('a Terra Code session can be named with /rename or from the list, and given its first message back', async () => {
  const page = await openCode()
  const box = page.getByRole('textbox', { name: 'Describe a change' })
  await box.fill('/rename')
  await box.press('Enter')
  await expect(page.getByText('Send a message first.')).toBeVisible()

  mock!.queue.push('Hello.')
  await box.fill('say hello')
  await box.press('Enter')
  await expect(page.getByText('Hello.', { exact: true })).toBeVisible()
  const list = page.getByRole('navigation', { name: 'Saved chats' })
  await expect(list.getByRole('link', { name: /say hello/ })).toBeVisible()

  await box.fill('/rename Greeting work')
  await box.press('Enter')
  await expect(page.getByText('Named this session “Greeting work”.')).toBeVisible()
  await expect(list.getByRole('link', { name: /Greeting work/ })).toBeVisible()
  await expect(page.locator('[title="Greeting work"]').first()).toBeVisible()

  // From the list, in place.
  await list.getByRole('link', { name: /Greeting work/ }).hover()
  await list.getByRole('button', { name: 'Rename' }).click()
  const field = list.getByRole('textbox', { name: 'Session name' })
  await field.fill('Hello project')
  await field.press('Enter')
  await expect(list.getByRole('link', { name: /Hello project/ })).toBeVisible()

  await box.fill('/rename')
  await box.press('Enter')
  await expect(list.getByRole('link', { name: /say hello/ })).toBeVisible()
})

test('review numbers a change’s lines as they are in the file, with no empty line after the last', async () => {
  const page = await openCode()
  const box = page.getByRole('textbox', { name: 'Describe a change' })
  mock!.queue.push(tool({ tool: 'edit', path: 'a.txt', find: 'three', replace: 'THREE' }), 'Done.')
  await box.fill('shout three')
  await box.press('Enter')
  const changed = page.getByRole('region', { name: 'Changed files' })
  await expect(changed).toContainText('1 file changed')
  await changed.getByRole('button', { name: 'Review' }).click()
  const review = page.getByRole('region', { name: 'Review changes' })
  const rows = await review.locator('.font-mono .group\\/line').allInnerTexts()
  const cleaned = rows.map((row) => row.replace(/\s+/g, ' ').trim())
  expect(cleaned).toEqual(['1 one', '2 two', '- three', '3 + THREE', '4 four'])
})
