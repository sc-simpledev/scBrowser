import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTab, go, launch, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let scratch = ''
let media: Server | null = null

test.beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'scb-101-'))
  site = await serveSite({ '/one': titled('Page one'), '/two': titled('Page two'), '/three': titled('Page three') })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
  media?.close()
  media = null
  rmSync(scratch, { recursive: true, force: true })
})

const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>
const tabTitles = () => main((g) => g.scbTabs.snapshot().tabs.map((tab: { title: string }) => tab.title))

/** A second of a quiet tone, as a WAV file, for a page that tries to play by itself. */
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

test('Dark in Settings turns scTerra’s own pages and toolbar dark, and back, at once', async () => {
  h = await launch()
  const chromeTheme = () => h.chrome.evaluate(() => document.documentElement.dataset.theme)
  await setSetting(h, { theme: 'dark' })
  await expect.poll(chromeTheme).toBe('dark')
  await go(h, 'sc://history')
  const page = await h.page('sc://history')
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(18, 18, 18)')
  expect(await h.chrome.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
  await setSetting(h, { theme: 'light' })
  await expect.poll(chromeTheme).toBe('light')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)')
  // A page opened while it's light starts light, with no dark flash first.
  await go(h, 'sc://downloads')
  const fresh = await h.page('sc://downloads')
  expect(await fresh.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
})

test('closing the tabs below one leaves it, the tabs above and pinned tabs', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/one'))
  await expect(activeTab(h)).toHaveText('Page one')
  for (const path of ['/two', '/three']) {
    await shortcut(h, 'T')
    await go(h, site.url(path))
  }
  await expect.poll(tabTitles).toEqual(['Page one', 'Page two', 'Page three'])
  const second = await main((g) => g.scbTabs.snapshot().tabs[1].id)
  await main((g, id) => g.scbTabs.closeAfter(id), second)
  await expect.poll(tabTitles).toEqual(['Page one', 'Page two'])
  expect(await main((g) => g.scbActions.verticalTabs())).toBe(true)
})

test('all open pages are bookmarked into a new folder, once', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/one'))
  await expect(activeTab(h)).toHaveText('Page one')
  await shortcut(h, 'T')
  await go(h, site.url('/two'))
  await expect(activeTab(h)).toHaveText('Page two')
  await main((g) => g.scbActions.bookmarkAllTabs())
  const saved = await main((g) => {
    const repo = g.scbCore.services.bookmarks
    const groups = repo.groups()
    return { groups: groups.map((group: { name: string }) => group.name), inFolder: repo.list().filter((bookmark: { groupId: number | null }) => bookmark.groupId === groups[0]?.id).map((bookmark: { title: string }) => bookmark.title) }
  })
  expect(saved.groups).toHaveLength(1)
  expect(saved.groups[0]).toMatch(/^Tabs, /)
  expect(saved.inFolder.sort()).toEqual(['Page one', 'Page two'])
  // Again: nothing new, so no empty folder.
  await main((g) => g.scbActions.bookmarkAllTabs())
  expect(await main((g) => g.scbCore.services.bookmarks.groups().length)).toBe(1)
})

test('bookmarks go out as a file any browser reads, and come in from one', async () => {
  h = await launch()
  const exported = join(scratch, 'out.html')
  const incoming = join(scratch, 'in.html')
  writeFileSync(
    incoming,
    `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3><DL><p><DT><A HREF="https://bar.example/">On the bar</A></DL><p><DT><H3>Recipes</H3><DL><p><DT><A HREF="https://soup.example/">Soup &amp; bread</A></DL><p></DL>`
  )
  await h.app.evaluate(({ dialog }, paths) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.exported })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.incoming] })) as typeof dialog.showOpenDialog
  }, { exported, incoming })
  await go(h, 'sc://bookmarks')
  const page = await h.page('sc://bookmarks')
  await page.getByRole('button', { name: 'Import a bookmarks file' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText('Imported 2 bookmarks, in their folders.')
  await expect(page.getByRole('region', { name: 'Recipes' })).toBeVisible()
  await expect(page.getByText('Soup & bread')).toBeVisible()
  await page.getByRole('button', { name: 'Export as a file' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  const html = readFileSync(exported, 'utf8')
  expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
  expect(html).toContain('<H3 ADD_DATE="')
  expect(html).toContain('>Recipes</H3>')
  expect(html).toContain('HREF="https://soup.example/"')
  expect(html).toContain('>Soup &amp; bread</A>')
})

test('with autoplay blocked, a page’s sound waits for a press; without, it plays', async () => {
  const wav = tone()
  media = createServer((req, res) => {
    if (req.url === '/tone.wav') {
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length })
      return void res.end(wav)
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Player</title><audio id="a" src="/tone.wav" autoplay loop></audio>')
  })
  await new Promise<void>((done) => media!.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(media.address() as AddressInfo).port}/`
  h = await launch()
  await setSetting(h, { httpsOnly: false, blockAutoplay: true })
  await shortcut(h, 'T')
  await go(h, url)
  await expect(activeTab(h)).toHaveText('Player')
  const blocked = await h.page(url)
  await expect.poll(() => blocked.evaluate(() => (document.getElementById('a') as HTMLAudioElement).readyState)).toBeGreaterThan(2)
  await blocked.waitForTimeout(400)
  expect(await blocked.evaluate(() => (document.getElementById('a') as HTMLAudioElement).paused)).toBe(true)
  await setSetting(h, { blockAutoplay: false })
  await shortcut(h, 'T')
  await go(h, `${url}?again`)
  const playing = await h.page('?again')
  await expect.poll(() => playing.evaluate(() => (document.getElementById('a') as HTMLAudioElement).paused)).toBe(false)
})
