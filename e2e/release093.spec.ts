import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTab, go, launch, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let scratch = ''

/**
 * Like Discord's web app: the sign-in lives only in memory while the page is open, and goes back
 * into storage from its beforeunload handler. A browser that closes pages without running it signs
 * the person out of the next copy of the page.
 */
const CHAT = `<!doctype html><title>Chat</title>
<button id="sign-in">Sign in</button>
<script>
  let token = localStorage.getItem('token')
  localStorage.removeItem('token')
  const show = () => { document.title = token ? 'Chat: signed in' : 'Chat: signed out' }
  document.getElementById('sign-in').onclick = () => { token = 'secret-123'; show() }
  addEventListener('beforeunload', () => { if (token) localStorage.setItem('token', token) })
  show()
</script>`

test.beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'scb-093-'))
  site = await serveSite({
    '/chat': CHAT,
    '/other': titled('Other page'),
    '/second': titled('Second page'),
    '/popper': titled('Popper', `<button id="open">Open one</button><iframe id="frame" style="width:300px;height:120px"></iframe>
<script>
  // A pop-under ad's way: a window with no click behind it, and one from a click.
  setTimeout(() => window.open('/other', '_blank'), 50)
  document.getElementById('open').onclick = () => window.open('/second', '_blank')
</script>`),
    '/framed': titled('Framed', `<button id="inside" style="width:200px;height:60px">Inside</button><script>document.getElementById('inside').onclick = () => window.open('/second', '_blank')</script>`),
    '/fruit': titled('Fruit', '<p>Apple apple APPLE pear</p>'),
    '/long': titled('Long page', `<div style="height: 6000px; background: linear-gradient(white, #ccc)">Tall</div>`)
  })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
  rmSync(scratch, { recursive: true, force: true })
})

/** The chat page's own title once it has loaded, not the tab's, which keeps the old one while it sleeps. */
const chatTitle = (h: Harness) =>
  h.app.evaluate(async ({ webContents }) => {
    const chat = webContents.getAllWebContents().find((contents) => !contents.isDestroyed() && contents.getURL().includes('/chat'))
    if (!chat || chat.isLoading()) return 'loading'
    return chat.executeJavaScript('document.readyState === "complete" ? document.title : "loading"')
  })

const tabsApi = <T>(h: Harness, run: string) => h.app.evaluate((_electron, source) => new Function('tabs', `return (${source})(tabs)`)((globalThis as unknown as { scbTabs: unknown }).scbTabs) as T, run)

test('a site that keeps its sign-in in memory stays signed in through sleep, closing and a restart', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/chat'))
  const chat = await h.page('/chat')
  await expect(chat).toHaveTitle('Chat: signed out')
  await chat.locator('#sign-in').click()
  await expect(chat).toHaveTitle('Chat: signed in')

  // Asleep and back.
  await shortcut(h, 'T')
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  const chatId = await tabsApi<number>(h, `(tabs) => tabs.snapshot().tabs.find((tab) => tab.url.includes('/chat')).id`)
  expect(await tabsApi<boolean>(h, `(tabs) => tabs.sleep(${chatId})`)).toBe(true)
  await h.chrome.getByRole('tab', { name: /Chat/ }).click()
  await expect(activeTab(h)).toHaveText(/Chat/)
  await expect.poll(() => chatTitle(h)).toBe('Chat: signed in')

  // Closed and reopened.
  await shortcut(h, 'W')
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
  await shortcut(h, 'T', ['control', 'shift'])
  await expect(activeTab(h)).toHaveText(/Chat/)
  await expect.poll(() => chatTitle(h)).toBe('Chat: signed in')

  // Quit and started again.
  await h.close()
  h = await launch(h.profile)
  await h.chrome.getByRole('tab', { name: /Chat/ }).click()
  await expect.poll(() => chatTitle(h)).toBe('Chat: signed in')
})

const actions = (h: Harness, name: string, ...args: unknown[]) =>
  h.app.evaluate((_electron, [name, args]) => (globalThis as unknown as { scbActions: Record<string, (...a: unknown[]) => unknown> }).scbActions[name as string]!(...(args as unknown[])), [name, args] as const)

const snapshot = (h: Harness) => tabsApi<{ tabs: { id: number; url: string; title: string; muted: boolean; zoomPercent: number; blockedPopups?: string[] }[]; activeId: number }>(h, `(tabs) => tabs.snapshot()`)

const settingsNow = (h: Harness) => h.chrome.evaluate(() => window.scb.invoke('settings:get')) as Promise<Record<string, unknown>>

test('pop-ups without a click are blocked and offered, clicks still open them, and an allowed site can', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/popper'))
  const page = await h.page('/popper')
  await expect(page).toHaveTitle('Popper')
  // The one opened by itself is stopped, and the address bar says so.
  const chip = h.chrome.getByRole('button', { name: 'Pop-up blocked' })
  await expect(chip).toBeVisible()
  expect((await snapshot(h)).tabs).toHaveLength(1)
  expect((await snapshot(h)).tabs[0]!.blockedPopups).toEqual([site.url('/other')])
  // A click opens one, as in any browser.
  await page.locator('#open').click()
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  // So does a click inside a frame from another site, which is a page of its own to Chromium.
  await h.chrome.getByRole('tab', { name: 'Popper' }).click()
  const framedUrl = site.url('/framed').replace('127.0.0.1', 'localhost')
  await page.evaluate((url) => ((document.getElementById('frame') as HTMLIFrameElement).src = url), framedUrl)
  const frame = page.frameLocator('#frame')
  await frame.locator('#inside').click()
  await expect(h.chrome.getByRole('tab')).toHaveCount(3)
  // The blocked one opens from the address bar's menu.
  const popper = (await snapshot(h)).tabs.find((tab) => tab.url.includes('/popper'))!
  await tabsApi(h, `(tabs) => tabs.openBlockedPopup(${popper.id}, ${JSON.stringify(site.url('/other'))})`)
  await expect(h.chrome.getByRole('tab', { name: 'Other page' })).toHaveCount(1)
  // An allowed site may open them whenever it likes.
  await setSetting(h, { popupsAllowed: ['127.0.0.1'] })
  await h.chrome.getByRole('tab', { name: 'Popper' }).click()
  await page.reload()
  await expect(h.chrome.getByRole('tab', { name: 'Other page' })).toHaveCount(2)
})

test('keyboard shortcuts can be changed in Settings, and the old key stops working', async () => {
  h = await launch()
  await go(h, 'sc://settings/#keyboard')
  const settings = await h.page('sc://settings')
  await expect(settings.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
  await settings.getByRole('button', { name: 'Add a key for New tab' }).click()
  await expect(settings.getByRole('button', { name: 'Press the keys for New tab' })).toBeVisible()
  await settings.keyboard.press('Control+Alt+Y')
  await expect.poll(async () => (await settingsNow(h)).shortcuts).toEqual({ 'new-tab': ['Ctrl+T', 'Ctrl+Alt+Y'] })
  // Taking Ctrl T away leaves only the new key.
  await settings.getByRole('button', { name: 'Remove Ctrl T', exact: true }).click()
  await expect.poll(async () => (await settingsNow(h)).shortcuts).toEqual({ 'new-tab': ['Ctrl+Alt+Y'] })
  const press = (keyCode: string, modifiers: string[]) =>
    h.app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
      const target = BrowserWindow.getAllWindows()[0]!.webContents
      target.sendInputEvent({ type: 'keyDown', keyCode, modifiers: modifiers as never })
      target.sendInputEvent({ type: 'keyUp', keyCode, modifiers: modifiers as never })
    }, { keyCode, modifiers })
  await press('T', ['control'])
  await h.chrome.waitForTimeout(300)
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
  await press('Y', ['control', 'alt'])
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  // Reset puts Ctrl T back.
  await h.chrome.getByRole('tab', { name: /Settings/ }).click()
  await settings.getByRole('button', { name: 'Reset New tab' }).click()
  await expect.poll(async () => (await settingsNow(h)).shortcuts).toEqual({})
})

test('Ctrl Tab can go by the tab used last, and settles when Ctrl is let go', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false, tabCycleOrder: 'recent' })
  await go(h, site.url('/other'))
  for (const path of ['/second', '/fruit']) {
    await tabsApi(h, `(tabs) => tabs.create(${JSON.stringify(site.url(path))})`)
  }
  await expect(h.chrome.getByRole('tab')).toHaveCount(3)
  // Used last: Fruit, then Other (picked again), so Second is the oldest.
  await h.chrome.getByRole('tab', { name: 'Other page' }).click()
  await h.chrome.getByRole('tab', { name: 'Fruit' }).click()
  const key = (type: 'keyDown' | 'keyUp', keyCode: string, modifiers: string[]) =>
    h.app.evaluate(({ BrowserWindow }, { type, keyCode, modifiers }) => BrowserWindow.getAllWindows()[0]!.webContents.sendInputEvent({ type, keyCode, modifiers: modifiers as never }), { type, keyCode, modifiers })
  await key('keyDown', 'Tab', ['control'])
  await expect(activeTab(h)).toHaveText(/Other page/)
  // Tab again with Ctrl still held goes further back.
  await key('keyDown', 'Tab', ['control'])
  await expect(activeTab(h)).toHaveText(/Second page/)
  await key('keyUp', 'Control', [])
  // Let go: Second is now the latest, and Fruit (where it started) the one before.
  await key('keyDown', 'Tab', ['control'])
  await key('keyUp', 'Control', [])
  await expect(activeTab(h)).toHaveText(/Fruit/)
})

test('Clear browsing data clears history from Settings, and Ctrl Shift Delete opens it', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/other'))
  await expect(activeTab(h)).toHaveText('Other page')
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('history:search', 'Other') as Promise<unknown[]>).then((rows) => rows.length)).toBeGreaterThan(0)
  await shortcut(h, 'Delete', ['control', 'shift'])
  const settings = await h.page('sc://settings')
  const section = settings.getByRole('region', { name: 'Clear browsing data' })
  await expect(section).toBeVisible()
  await section.getByRole('combobox', { name: 'Time range' }).selectOption('all')
  await section.getByRole('checkbox', { name: /Cached pictures/ }).uncheck()
  await section.getByRole('button', { name: 'Clear data' }).click()
  await expect(section.getByRole('status')).toHaveText('Cleared.')
  expect(await h.chrome.evaluate(() => window.scb.invoke('history:search', 'Other') as Promise<unknown[]>)).toEqual([])
})

test('JSON pages show as a tree, with the original kept for Raw', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ name: 'scTerra', list: [1, 2, 3], nested: { deep: { deeper: true } }, link: 'https://example.com/' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    h = await launch()
    await setSetting(h, { httpsOnly: false })
    await go(h, `http://127.0.0.1:${(server.address() as AddressInfo).port}/data.json`)
    const page = await h.page('/data.json')
    await expect(page.locator('scterra-json')).toBeAttached()
    await expect(page.locator('body > pre')).toBeHidden()
    // The viewer lives where the page's own scripts can't reach it.
    expect(await page.evaluate(() => document.querySelector('scterra-json')!.shadowRoot)).toBeNull()
  } finally {
    server.close()
  }
})

test('tabs: close duplicates, copy links, mute a site, move a tab to a new window', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/other'))
  for (const path of ['/other', '/second', '/other#part']) await tabsApi(h, `(tabs) => tabs.create(${JSON.stringify(site.url(path))})`)
  await expect(h.chrome.getByRole('tab')).toHaveCount(4)
  await actions(h, 'closeDuplicates')
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)

  // Titled once loaded, in the order the tabs sit.
  await expect.poll(async () => (await snapshot(h)).tabs.every((tab) => tab.title.endsWith('page'))).toBe(true)
  const kept = (await snapshot(h)).tabs
  expect(kept.map((tab) => tab.url)).toEqual([site.url('/second'), site.url('/other#part')])
  await actions(h, 'copyTabLinks')
  await expect.poll(() => h.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`- [Second page](${site.url('/second')})\n- [Other page](${site.url('/other#part')})`)

  const second = (await snapshot(h)).tabs.find((tab) => tab.url.includes('/second'))!
  await actions(h, 'toggleSiteMute', second.id)
  await expect.poll(async () => (await snapshot(h)).tabs.every((tab) => tab.muted)).toBe(true)
  expect((await settingsNow(h)).mutedSites).toEqual(['127.0.0.1'])
  await actions(h, 'toggleSiteMute', second.id)
  await expect.poll(async () => (await snapshot(h)).tabs.some((tab) => tab.muted)).toBe(false)

  await actions(h, 'moveTabToWindow', second.id, 'new')
  await expect.poll(() => h.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(2)
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
  await expect.poll(() => h.app.evaluate(({ webContents }) => webContents.getAllWebContents().some((contents) => contents.getURL().endsWith('/second')))).toBe(true)
})

test('Home, startup pages and the default zoom', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false, homePage: site.url('/second'), homeButton: true, defaultZoom: 125 })
  await h.chrome.getByRole('button', { name: 'Home' }).click()
  await expect(activeTab(h)).toHaveText('Second page')
  await expect.poll(async () => (await snapshot(h)).tabs[0]!.zoomPercent).toBe(125)
  // At the usual zoom for every site, the address bar has no zoom badge.
  await expect(h.chrome.getByRole('button', { name: /^Zoom / })).toHaveCount(0)
  await setSetting(h, { startup: 'pages', startupPages: [site.url('/other'), site.url('/fruit')] })
  await h.close()
  h = await launch(h.profile)
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  await expect(activeTab(h)).toHaveText('Other page')
})

test('Global Privacy Control goes with requests and is there for scripts', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><title>GPC ${req.headers['sec-gpc'] ?? 'none'}</title><script>document.title += ' ' + navigator.globalPrivacyControl</script>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    h = await launch()
    await setSetting(h, { httpsOnly: false })
    const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gpc`
    await go(h, address)
    await expect(activeTab(h)).toHaveText('GPC 1 true')
    await setSetting(h, { globalPrivacyControl: false })
    await go(h, `${address}?off`)
    await expect(activeTab(h)).toHaveText('GPC none undefined')
  } finally {
    server.close()
  }
})

test('Find can match case', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/fruit'))
  await expect(activeTab(h)).toHaveText('Fruit')
  await shortcut(h, 'F')
  const find = h.chrome.getByRole('textbox', { name: 'Find in page' })
  await find.fill('apple')
  await expect(h.chrome.getByRole('search').getByText(/^\d of 3$/)).toBeVisible()
  await h.chrome.getByRole('button', { name: 'Match case' }).click()
  await expect(h.chrome.getByRole('search').getByText('1 of 1')).toBeVisible()
})

test('Save page writes the whole page, or one .mhtml file', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/other'))
  await expect(activeTab(h)).toHaveText('Other page')
  for (const name of ['saved.html', 'saved.mhtml']) {
    const filePath = join(scratch, name)
    await h.app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
    }, filePath)
    await actions(h, 'savePage')
    await expect.poll(() => existsSync(filePath)).toBe(true)
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('Other page')
  }
  expect(readFileSync(join(scratch, 'saved.mhtml'), 'utf8')).toContain('MIME-Version')
})

test('hover cards carry a picture of the page once it has been left', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
  await go(h, site.url('/other'))
  await expect(activeTab(h)).toHaveText('Other page')
  const first = (await snapshot(h)).tabs[0]!.id
  await shortcut(h, 'T')
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  await expect.poll(() => h.chrome.evaluate((id) => window.scb.invoke('tabs:preview', id), first)).toMatch(/^data:image\/jpeg;base64,/)
  await setSetting(h, { tabPreviews: false })
})

test('middle-click scrolling and mouse gestures, when turned on', async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false, middleClickScroll: true, mouseGestures: true })
  await go(h, site.url('/other'))
  await go(h, site.url('/long'))
  const page = await h.page('/long')
  await expect(page).toHaveTitle('Long page')
  const mouse = (events: Record<string, unknown>[]) =>
    h.app.evaluate(({ webContents }, events) => {
      const contents = webContents.getAllWebContents().find((one) => one.getURL().endsWith('/long'))!
      for (const event of events) contents.sendInputEvent(event as never)
    }, events)
  // Press the wheel, move down past the mark, and the page scrolls by itself.
  await mouse([
    { type: 'mouseMove', x: 300, y: 200 },
    { type: 'mouseDown', x: 300, y: 200, button: 'middle', clickCount: 1 },
    { type: 'mouseUp', x: 300, y: 200, button: 'middle', clickCount: 1 },
    { type: 'mouseMove', x: 300, y: 320 }
  ])
  await expect.poll(() => page.evaluate(() => scrollY), { timeout: 5000 }).toBeGreaterThan(200)
  await mouse([{ type: 'mouseDown', x: 300, y: 320, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: 300, y: 320, button: 'left', clickCount: 1 }])
  const stopped = await page.evaluate(() => scrollY)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => scrollY)).toBe(stopped)
  // Right button held, drawn to the left: back.
  await mouse([
    { type: 'mouseDown', x: 400, y: 200, button: 'right', clickCount: 1 },
    { type: 'mouseMove', x: 360, y: 200, modifiers: ['rightButtonDown'] },
    { type: 'mouseMove', x: 300, y: 202, modifiers: ['rightButtonDown'] },
    { type: 'mouseMove', x: 240, y: 204, modifiers: ['rightButtonDown'] },
    { type: 'mouseUp', x: 240, y: 204, button: 'right', clickCount: 1 }
  ])
  await expect(activeTab(h)).toHaveText('Other page')
})

test('reader view takes its text and colours from Settings', async () => {
  h = await launch()
  const article = `<!doctype html><title>An article</title><article><h1>An article</h1>${'<p>Plenty of words in a paragraph that reader view keeps, so it has something to show here.</p>'.repeat(30)}</article>`
  const reading = await serveSite({ '/article': article })
  try {
    await setSetting(h, { httpsOnly: false, readerStyle: { font: 'serif', size: 'large', width: 'narrow', theme: 'sepia' } })
    await go(h, reading.url('/article'))
    await expect(activeTab(h)).toHaveText('An article')
    await h.chrome.getByRole('button', { name: 'Reader view', exact: true }).click()
    const page = await h.page('sc://reader')
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 239, 223)')
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('main')!).maxWidth)).toBe('580px')
    await expect(h.chrome.getByRole('button', { name: 'Text size, font and colours' })).toBeVisible()
  } finally {
    reading.server.close()
  }
})
