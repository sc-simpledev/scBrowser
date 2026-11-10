import { createHmac } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, serveSite, setSetting, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock | null = null
let pages: Record<string, string>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>
const tabCount = () => main((g) => g.scbTabs.snapshot().tabs.length) as Promise<number>
const settings = () => h.chrome.evaluate(() => window.scb.invoke('settings:get')) as Promise<Record<string, unknown>>

const ARTICLE = `<article>${'<p>The secret ingredient is cardamom, and this paragraph repeats so the page reads as an article.</p>'.repeat(6)}</article>`

test.beforeEach(async () => {
  pages = {
    '/alpha': titled('Alpha page'),
    '/beta': titled('Beta page'),
    '/article': titled('Long read', ARTICLE),
    '/other': titled('Second tab', '<p>The second tab talks about rhubarb, and only rhubarb, at some length here.</p>'),
    '/links': titled('Links', '<p><a href="/beta">Beta link</a></p>'),
    '/consent': `<!doctype html><title>Consent</title><p>Page</p><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;padding:20px;background:#eee"><button id="onetrust-accept-btn-handler" onclick="document.title='accepted'">Accept all</button><button id="onetrust-reject-all-handler" onclick="document.title='rejected';this.parentNode.remove()">Reject all</button></div>`,
    '/late-banner': `<!doctype html><title>Late</title><p>Page</p><script>setTimeout(() => { const box = document.createElement('div'); box.className = 'site-cookie-banner'; box.style.cssText = 'position:fixed;bottom:0;padding:20px;background:#eee'; box.innerHTML = '<button onclick="document.title=\\'accepted\\'">Accept</button> <button onclick="document.title=\\'declined\\'">Only necessary</button>'; document.body.append(box) }, 800)</script>`,
    '/promo': titled('Promo page', '<div id="promo" style="height:120px;background:#c33;color:#fff">Promo</div><p>The rest of the page.</p>'),
    '/store': titled('Store', '<script>document.cookie = "visited=yes; max-age=3600"; localStorage.setItem("kept", "yes")</script>'),
    '/price': titled('Shop', '<p>Price: $10</p><p>In stock</p>')
  }
  site = await serveSite(pages)
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
  if (mock) {
    mock.server.closeAllConnections()
    mock.server.close()
    mock = null
  }
})

async function addProvider() {
  mock = await startAiMock()
  await go(h, 'sc://ai')
  const page = await h.page('sc://ai')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await page.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await page.getByRole('combobox', { name: 'API format' }).selectOption('openai')
  await page.getByRole('textbox', { name: 'API key' }).fill('test-key-not-real-12345')
  await page.getByRole('button', { name: 'Add provider' }).click()
  await expect(page.getByText('Connected, 1 model available')).toBeVisible()
  await page.getByRole('combobox', { name: 'Chat model for Mock AI' }).selectOption('mock-model')
}

const lastUserMessage = () => mock?.requests.at(-1)?.body.messages?.at(-1)?.content ?? ''

test.describe('privacy and passwords', () => {
  test('cookie banners are rejected, never accepted, including ones that come late, and can be left alone', async () => {
    h = await launch()
    await go(h, site.url('/consent'))
    await expect(activeTab(h)).toHaveText('rejected')
    await go(h, site.url('/late-banner'))
    await expect(activeTab(h)).toHaveText('declined')
    await setSetting(h, { rejectCookieBanners: false })
    pages['/consent-left'] = pages['/consent']!
    await main((g, url: string) => g.scbTabs.navigate(g.scbTabs.active.id, url), site.url('/consent-left'))
    await expect(activeTab(h)).toHaveText('Consent')
    await h.chrome.waitForTimeout(1500)
    await expect(activeTab(h)).toHaveText('Consent')
  })

  test('two-step codes are made from a pasted key, shown and copied, and the key never comes back', async () => {
    h = await launch()
    await go(h, 'sc://passwords')
    const page = await h.page('sc://passwords')
    await page.getByRole('radio', { name: /No master password/ }).check()
    await page.getByRole('button', { name: 'Create vault' }).click()
    await page.getByRole('button', { name: 'Add login' }).click()
    await page.getByRole('textbox', { name: 'Website' }).fill('https://example.com')
    await page.getByRole('textbox', { name: 'Username' }).fill('sam')
    await page.getByRole('textbox', { name: 'Two-step key' }).fill('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ')
    await page.getByRole('button', { name: 'Save' }).click()
    const chip = page.getByRole('button', { name: /Copy two-step code/ })
    await expect(chip).toBeVisible()
    const expected = [0, 30].map((ahead) => {
      const counter = Buffer.alloc(8)
      counter.writeBigUInt64BE(BigInt(Math.floor((Date.now() / 1000 + ahead) / 30)))
      const hmac = createHmac('sha1', Buffer.from('12345678901234567890')).update(counter).digest()
      const offset = hmac[19]! & 0xf
      const code = String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
      return `${code.slice(0, 3)} ${code.slice(3)}`
    })
    expect(expected).toContain((await chip.textContent())?.trim())
    await page.getByRole('button', { name: 'Edit login' }).click()
    await expect(page.getByText('Two-step codes are set up')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Two-step key' })).toHaveCount(0)
    expect(await page.content()).not.toContain('GEZDGNBV')
  })

  test('the leak check only runs when asked, and says when it can’t reach the service', async () => {
    h = await launch(undefined, ['--host-resolver-rules=MAP api.pwnedpasswords.com ~NOTFOUND'])
    await go(h, 'sc://passwords')
    const page = await h.page('sc://passwords')
    await page.getByRole('radio', { name: /No master password/ }).check()
    await page.getByRole('button', { name: 'Create vault' }).click()
    await page.getByRole('button', { name: 'Add login' }).click()
    await page.getByRole('textbox', { name: 'Website' }).fill('https://example.com')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByLabel('Leak check')).toContainText('only the first 5 characters')
    await page.getByRole('button', { name: 'Check now' }).click()
    await expect(page.getByLabel('Leak check').getByRole('alert')).toBeVisible()
  })

  test('forgetting a site clears its cookies, storage and history, and can be set for every close', async () => {
    h = await launch()
    await go(h, site.url('/store'))
    await expect(activeTab(h)).toHaveText('Store')
    const cookies = () => h.app.evaluate(({ session }) => session.defaultSession.cookies.get({}).then((list) => list.length))
    expect(await cookies()).toBeGreaterThan(0)
    await h.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: true })) as never
    })
    await main((g) => g.scbActions.forgetSite())
    await expect.poll(cookies).toBe(0)
    await expect.poll(async () => (await settings()).forgetOnClose).toEqual(['127.0.0.1'])
    const history = await main((g) => g.scbCore.services.history.list('', 50, 0).map((entry: { url: string }) => entry.url))
    expect(history.filter((url: string) => url.includes('/store'))).toEqual([])
    // The tab reloads, so the page sets its own data again; reading before that shows it was cleared.
    const page = await h.page('/store')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('kept'))).toBe('yes')
  })

  test('a part of a page can be picked and hidden on that site, and shown again', async () => {
    h = await launch()
    await go(h, site.url('/promo'))
    await expect(activeTab(h)).toHaveText('Promo page')
    const page = await h.page('/promo')
    void main((g) => g.scbActions.hidePart())
    await expect.poll(() => page.evaluate(() => !!document.querySelector('scterra-picker'))).toBe(true)
    const box = (await page.locator('#promo').boundingBox())!
    await page.mouse.move(box.x + 20, box.y + 20)
    await page.mouse.click(box.x + 20, box.y + 20)
    await expect.poll(async () => (await settings()).hiddenElements).toEqual({ '127.0.0.1': ['#promo'] })
    await expect(page.locator('#promo')).toBeHidden()
    await page.reload()
    await expect(page.locator('#promo')).toBeHidden()
    await main((g) => g.scbActions.showHiddenParts())
    await expect(page.locator('#promo')).toBeVisible()
  })
})

test.describe('browsing', () => {
  test('shift-click previews a link over the page, and it can become a tab', async () => {
    h = await launch()
    await go(h, site.url('/links'))
    await expect(activeTab(h)).toHaveText('Links')
    const page = await h.page('/links')
    const before = await tabCount()
    await page.getByRole('link', { name: 'Beta link' }).click({ modifiers: ['Shift'] })
    const overlay = await h.overlay()
    const card = overlay.getByRole('dialog', { name: /Preview of 127\.0\.0\.1/ })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Beta page')
    expect(await tabCount()).toBe(before)
    await card.getByRole('button', { name: 'Open as tab' }).click()
    await expect(activeTab(h)).toHaveText('Beta page')
    expect(await tabCount()).toBe(before + 1)
    await expect(card).toHaveCount(0)
  })

  test('sites in the sidebar open beside the page without becoming tabs', async () => {
    h = await launch()
    await go(h, site.url('/beta'))
    await setSetting(h, { sidebarSites: [{ url: site.url('/alpha'), title: 'Alpha page' }] })
    const rail = h.chrome.getByRole('navigation', { name: 'Sidebar sites' })
    await rail.getByRole('button', { name: 'Alpha page' }).click()
    const panel = h.chrome.getByRole('complementary', { name: /in the sidebar/ })
    await expect(panel).toContainText('Alpha page')
    expect(await tabCount()).toBe(1)
    expect(await h.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some((contents) => contents.getURL() === url), site.url('/alpha'))).toBe(true)
    await panel.getByRole('button', { name: 'Close' }).click()
    await expect(panel).toHaveCount(0)
    await setSetting(h, { sidebarSites: [] })
    await expect(rail).toHaveCount(0)
  })

  test('a watched page says what changed', async () => {
    h = await launch()
    await main((g) => {
      g.scbCore.watcher.notify = () => undefined
    })
    const watch = await main((g, url: string) => g.scbCore.watcher.add(url, 'Shop', null), site.url('/price'))
    pages['/price'] = titled('Shop', '<p>Price: $8</p><p>In stock</p>')
    await main((g, id: string) => g.scbCore.watcher.check(id), watch.id)
    await go(h, 'sc://watching')
    const page = await h.page('sc://watching')
    await expect(page.getByLabel('Changed', { exact: true })).toBeVisible()
    await expect(page.getByLabel('What changed')).toContainText('Price: $8')
    await expect(page.getByLabel('What changed')).toContainText('Price: $10')
  })

  test('unused tabs go to the archive, and come back from it', async () => {
    h = await launch()
    await go(h, site.url('/alpha'))
    await main((g, url: string) => g.scbTabs.create(url), site.url('/beta'))
    await expect(activeTab(h)).toHaveText('Beta page')
    await main((g) => g.scbCore.archive.add(g.scbTabs.archiveIdle(0)))
    expect(await tabCount()).toBe(1)
    await go(h, 'sc://archive')
    const page = await h.page('sc://archive')
    await page.getByRole('button', { name: 'Alpha page' }).click()
    await expect.poll(tabCount).toBe(2)
    await expect(page.getByRole('button', { name: 'Alpha page' })).toHaveCount(0)
  })
})

test.describe('AI', () => {
  test('citations link back to the words in their tab', async () => {
    h = await launch()
    await addProvider()
    await go(h, site.url('/article'))
    await expect(activeTab(h)).toHaveText('Long read')
    await h.chrome.getByRole('button', { name: 'Assistant' }).click()
    const panel = h.chrome.getByRole('complementary', { name: 'Assistant' })
    mock!.queue.push('The secret is cardamom [1: "secret ingredient is cardamom"].')
    await panel.getByRole('textbox', { name: 'Message the assistant' }).fill('What is the secret?')
    await panel.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
    const chip = panel.getByRole('button', { name: /Long read: “secret ingredient is cardamom”/ })
    await expect(chip).toBeVisible()
    expect(lastUserMessage()).toContain('<page id="1"')
    await chip.click()
    const page = await h.page('/article')
    await expect.poll(() => page.evaluate(() => CSS.highlights.has('scterra-cite'))).toBe(true)
  })

  test('the full-page assistant researches across picked tabs, and cites each', async () => {
    h = await launch()
    await addProvider()
    await go(h, site.url('/article'))
    await main((g, url: string) => g.scbTabs.create(url), site.url('/other'))
    await expect(activeTab(h)).toHaveText('Second tab')
    await main((g) => g.scbTabs.create('sc://assistant'))
    const page = await h.page('sc://assistant')
    await page.getByRole('button', { name: 'Tabs', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Pick tabs to research' })
    await picker.getByRole('checkbox', { name: /Long read/ }).click()
    await picker.getByRole('checkbox', { name: /Second tab/ }).click()
    await picker.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('list', { name: 'Tabs to research' })).toContainText('Second tab')
    mock!.queue.push('Cardamom [1] and rhubarb [2].')
    await page.getByRole('textbox', { name: 'Message the assistant' }).fill('Compare them')
    await page.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
    await expect(page.getByRole('list', { name: 'Sources' })).toContainText('Second tab')
    const sent = lastUserMessage()
    expect(sent).toContain('<page id="1"')
    expect(sent).toContain('<page id="2"')
    expect(sent).toContain('cardamom')
    expect(sent).toContain('rhubarb')
  })

  test('highlights are kept, marked again on return, and only they go into a report', async () => {
    h = await launch()
    await addProvider()
    await go(h, site.url('/article'))
    await expect(activeTab(h)).toHaveText('Long read')
    await main((g) => {
      const contents = g.scbTabs.contentsFor(g.scbTabs.active.id)
      g.scbActions.highlight(contents, 'secret ingredient is cardamom')
    })
    const page = await h.page('/article')
    await expect.poll(() => page.evaluate(() => CSS.highlights.has('scterra-mark'))).toBe(true)
    await page.reload()
    await expect.poll(() => page.evaluate(() => CSS.highlights.has('scterra-mark'))).toBe(true)
    await go(h, 'sc://highlights')
    const list = await h.page('sc://highlights')
    await expect(list.getByRole('button', { name: 'secret ingredient is cardamom' })).toBeVisible()
    mock!.queue.push('A report.')
    await list.getByRole('button', { name: /Write a report from all/ }).click()
    await expect.poll(lastUserMessage).toContain('secret ingredient is cardamom')
    expect(lastUserMessage()).not.toContain('this paragraph repeats')
  })

  test('the reading list summarises a page only when asked', async () => {
    h = await launch()
    await addProvider()
    await go(h, site.url('/article'))
    await expect(activeTab(h)).toHaveText('Long read')
    await main((g) => g.scbActions.addToReadingList())
    const asked = mock!.requests.length
    await main((g) => g.scbTabs.create('sc://reading'))
    const page = await h.page('sc://reading')
    await page.getByRole('button', { name: 'All 1' }).click()
    expect(mock!.requests.length).toBe(asked)
    mock!.queue.push('- It is about cardamom.')
    await page.getByRole('button', { name: 'Summarise', exact: true }).click()
    await expect(page.getByText('It is about cardamom.')).toBeVisible()
    expect(lastUserMessage()).toContain('secret ingredient is cardamom')
  })

  test('a kept mini app runs in its own window, keeps its data, and can’t reach the network', async () => {
    h = await launch()
    const html = `<!doctype html><title>Tally</title><body><script>
      localStorage.n = String(Number(localStorage.n || 0) + 1)
      document.body.dataset.count = localStorage.n
      fetch(${JSON.stringify(site.url('/alpha'))}).then(() => (document.body.dataset.net = 'reached'), () => (document.body.dataset.net = 'blocked'))
    </script></body>`
    const id = await main((g, content: string) => g.scbCore.miniApps.keep('tally.html', content).id, html)
    await main((g, app: string) => g.scbCore.miniApps.launch(app), id)
    const app = await h.page('sc-app://')
    await expect(app.locator('body')).toHaveAttribute('data-net', 'blocked')
    await expect(app.locator('body')).toHaveAttribute('data-count', '1')
    await app.reload()
    await expect(app.locator('body')).toHaveAttribute('data-count', '2')
    expect(await app.evaluate(() => typeof (window as unknown as { scbInternal?: unknown }).scbInternal)).toBe('undefined')
  })
})
