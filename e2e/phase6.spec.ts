import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, omnibox, serveSite, setSetting, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock

test.beforeEach(async () => {
  mock = await startAiMock()
  site = await serveSite({ '/alpha': titled('Alpha page'), '/beta': titled('Beta page') })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  mock.server.closeAllConnections()
  mock.server.close()
  site.server.close()
})

const rule = (domain: string, when = 'always') => ({ id: domain, domain, when, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' })
const blocker = (patch: Record<string, unknown>) => ({ enabled: true, rules: [], messages: [], categories: [], categoryMode: 'off', allowlist: [], ...patch })

test('a small button under the tabs opens a new tab', async () => {
  await h.chrome.getByRole('tablist').getByRole('button', { name: 'New tab' }).click()
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
})

test('the scSpace accent is the default, and moves older profiles over', async () => {
  await expect(h.chrome.locator('html')).toHaveAttribute('data-accent', 'teal')
})

test('the star edits the name, and bookmarks can be grouped and edited from the bar', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  await h.chrome.getByRole('button', { name: 'Bookmark this page' }).click()
  const overlay = await h.overlay()
  const dialog = overlay.getByRole('dialog', { name: 'Edit bookmark' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Bookmark address' })).toHaveCount(0)
  await dialog.getByRole('textbox', { name: 'Bookmark name' }).fill('Renamed')
  await dialog.getByRole('button', { name: 'Save' }).click()
  const bar = h.chrome.getByRole('toolbar', { name: 'Bookmarks' })
  await expect(bar.getByRole('button', { name: 'Renamed' })).toBeVisible()

  await go(h, 'sc://bookmarks')
  const page = await h.page('sc://bookmarks')
  await page.getByRole('textbox', { name: 'New group name' }).fill('Work')
  await page.getByRole('button', { name: 'Add group' }).click()
  await page.getByRole('combobox', { name: 'Group for Renamed' }).selectOption({ label: 'Work' })
  await expect(page.getByRole('region', { name: 'Work' }).getByText('Renamed')).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Work' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Renamed' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('textbox', { name: 'Bookmark address' }).fill(site.url('/beta'))
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(site.url('/beta'))).toBeVisible()
})

test('bookmarks drag along the bar and into a group', async () => {
  await go(h, 'sc://bookmarks')
  await h.chrome.evaluate(
    async (urls) => {
      for (const url of urls) await window.scb.invoke('bookmarks:toggle', url, url.slice(-4))
    },
    [site.url('/one'), site.url('/two')]
  )
  const bar = h.chrome.getByRole('toolbar', { name: 'Bookmarks' })
  await bar.getByRole('button', { name: '/two' }).dragTo(bar.getByRole('button', { name: '/one' }), { targetPosition: { x: 2, y: 8 } })
  await expect(bar.getByRole('button')).toHaveText(['/two', '/one'])

  const page = await h.page('sc://bookmarks')
  await page.getByRole('textbox', { name: 'New group name' }).fill('Work')
  await page.getByRole('button', { name: 'Add group' }).click()
  await bar.getByRole('button', { name: '/one' }).dragTo(bar.getByRole('button', { name: 'Work' }))
  await expect(bar.getByRole('button', { name: '/one' })).toHaveCount(0)
})

test('a blocked site shows a message, and both ways out work', async () => {
  await setSetting(h, { blocker: blocker({ rules: [rule('127.0.0.1')], messages: ['Back to work'] }) })
  await go(h, site.url('/alpha'))
  const page = await h.page('sc://blocked')
  await expect(page.getByRole('heading', { name: 'Back to work' })).toBeVisible()
  await expect(omnibox(h)).toHaveValue(site.url('/alpha'))

  await page.getByRole('button', { name: 'Go to a new tab' }).click()
  await expect(activeTab(h)).toContainText('New tab')

  await go(h, site.url('/alpha'))
  const again = await h.page('sc://blocked')
  await again.getByRole('button', { name: 'Continue to the site' }).click()
  await expect(activeTab(h)).toContainText('Alpha page')
})

test('the allowlist beats a rule, and Focus Mode rules wait for Focus Mode', async () => {
  await setSetting(h, { blocker: blocker({ rules: [rule('127.0.0.1')], allowlist: ['127.0.0.1'] }) })
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')

  await setSetting(h, { blocker: blocker({ rules: [rule('127.0.0.1', 'focus')] }) })
  await go(h, site.url('/beta'))
  await expect(activeTab(h)).toContainText('Beta page')
  await setSetting(h, { focusMode: true })
  await go(h, site.url('/alpha'))
  await expect((await h.page('sc://blocked')).getByText('Focus Mode')).toBeVisible()
})

test('a category check sends only the site name, once per site', async () => {
  await go(h, 'sc://ai')
  const ai = await h.page('sc://ai')
  await ai.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await ai.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await ai.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await ai.getByRole('button', { name: 'Add provider' }).click()
  const picker = ai.getByRole('combobox', { name: 'Chat model for Mock AI' })
  await expect(ai.getByText('Connected, 1 model available')).toBeVisible()
  await picker.selectOption('mock-model')
  await expect(picker).toHaveValue('mock-model')

  // Local addresses are never sent, so this goes to a made-up site that fails to load.
  const before = mock.requests.length
  await setSetting(h, { httpsOnly: false, blocker: blocker({ categories: ['Games'], categoryMode: 'always' }) })
  mock.queue = ['{"category":"Games"}']
  await go(h, 'http://games.invalid/some/page?x=1')
  const page = await h.page('sc://blocked')
  await expect(page.getByText('looks like Games')).toBeVisible()
  expect(mock.requests.length).toBe(before + 1)
  expect(mock.requests.at(-1)?.body.messages?.at(-1)?.content).toBe('games.invalid')

  await page.getByRole('button', { name: 'Go to a new tab' }).click()
  await go(h, 'http://games.invalid/another')
  await expect(await h.page('sc://blocked')).toBeTruthy()
  expect(mock.requests.length).toBe(before + 1)
})

test('with a connection added, the VPN carries pages through it and turns off cleanly', async () => {
  const seen: string[] = []
  const proxy: Server = createServer((req, res) => {
    seen.push(req.url ?? '')
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Through the proxy</title>')
  })
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
  const { port } = proxy.address() as AddressInfo

  await expect(h.chrome.getByRole('button', { name: /^VPN/ })).toHaveCount(0)
  await go(h, 'sc://vpn')
  const page = await h.page('sc://vpn')
  await page.getByRole('textbox', { name: 'Connection links' }).fill(`http://127.0.0.1:${port}#Local\nhysteria2://x@y:1`)
  await page.getByRole('button', { name: 'Add links' }).click()
  await expect(page.getByRole('status')).toContainText('Added 1, skipped 1')
  await expect(h.chrome.getByRole('button', { name: /^VPN/ })).toBeVisible()

  await page.getByRole('button', { name: 'Ping' }).click()
  await expect(page.getByText(/\d+ ms/)).toBeVisible()

  await page.getByRole('switch', { name: 'VPN' }).click()
  await expect(h.chrome.getByRole('button', { name: 'VPN: on, Local' })).toBeVisible()
  await setSetting(h, { httpsOnly: false })
  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  await go(h, 'http://vpn-check.example/')
  await expect(activeTab(h)).toContainText('Through the proxy')
  expect(seen.some((url) => url.includes('vpn-check.example'))).toBe(true)

  await page.getByRole('switch', { name: 'VPN' }).click()
  await expect(h.chrome.getByRole('button', { name: 'VPN: off' })).toBeVisible()
  const count = seen.length
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  expect(seen.length).toBe(count)
  proxy.closeAllConnections()
  proxy.close()
})
