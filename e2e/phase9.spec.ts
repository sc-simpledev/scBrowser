import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { go, launch, newProfile, serveSite, setSetting, type Harness } from './app'

let h: Harness

test.afterEach(async () => {
  await h.close().catch(() => undefined)
})

test('a tooltip on an sc:// page never takes the clicks of what is under it', async () => {
  h = await launch()
  await go(h, 'sc://vpn')
  const page = await h.page('sc://vpn')
  await page.getByRole('textbox', { name: 'Connection links' }).fill('http://127.0.0.1:9#One\nhttp://127.0.0.1:8#Two')
  await page.getByRole('button', { name: 'Add links' }).click()
  // A move sent straight to the button: on a display with no window manager, stray moves dismiss a real hover.
  await page.getByRole('button', { name: 'Remove One' }).dispatchEvent('pointermove', { bubbles: true, pointerType: 'mouse' })
  const tip = page.locator('[data-radix-popper-content-wrapper]')
  await expect(tip).toContainText('Remove One')
  const box = (await tip.boundingBox())!
  const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.sc-tooltip'), { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  expect(onTop).toBe(false)
})

test('the new tab colour picker stays inside the window, and sets the colour', async () => {
  h = await launch()
  await go(h, 'sc://newtab/?customise')
  const page = await h.page('sc://newtab')
  await page.getByRole('combobox', { name: 'Background type' }).selectOption('color')
  await page.getByRole('button', { name: 'Background colour' }).click()
  const picker = page.getByRole('group', { name: 'Colour picker' })
  await expect(picker).toBeVisible()
  const box = (await picker.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  const code = picker.getByRole('textbox', { name: 'Colour code' })
  await code.fill('#336699')
  await expect(page.getByRole('button', { name: 'Background colour' })).toHaveCSS('background-color', 'rgb(51, 102, 153)')
  const square = (await picker.getByRole('slider', { name: 'Saturation and brightness' }).boundingBox())!
  await page.mouse.click(square.x + square.width - 1, square.y + 1)
  await expect(code).not.toHaveValue('#336699')
  await expect(code).toHaveValue(/^#[0-9a-f]{6}$/)
  await picker.getByRole('button', { name: 'Use #334155' }).click()
  await expect(code).toHaveValue('#334155')
})

test('only Google sign-in pages see Electron named, in headers and to scripts', async () => {
  const seen: Record<string, Record<string, string | string[] | undefined>> = {}
  const server: Server = createServer((req, res) => {
    seen[req.headers.host!.split(':')[0]!] = req.headers
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Echo</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  h = await launch(undefined, ['--host-resolver-rules=MAP signin.test 127.0.0.1, MAP other.test 127.0.0.1'], { SCB_SIGN_IN_HOST: 'signin.test' })
  await setSetting(h, { httpsOnly: false })
  await go(h, `http://signin.test:${port}/signin`)
  const page = await h.page('signin.test')
  await expect.poll(() => seen['signin.test']?.['user-agent']).toContain('Electron/')
  await expect.poll(() => page.evaluate(() => navigator.userAgent)).toContain('Electron/')

  await go(h, `http://other.test:${port}/`)
  const other = await h.page('other.test')
  await expect.poll(() => seen['other.test']?.['user-agent']).toContain('Chrome/')
  expect(seen['other.test']!['user-agent']).not.toContain('Electron')
  await expect.poll(() => other.evaluate(() => navigator.userAgent)).toContain('Chrome/')
  server.closeAllConnections()
  server.close()
})

test('fun flags switch on after a restart, and take no clicks', async () => {
  const profile = newProfile()
  writeFileSync(join(profile, 'flags.json'), JSON.stringify(['retro-screen', 'wobbly-tabs', 'aurora', 'day-cycle', 'site-colours', 'clicky-keys', 'download-sparkles']))
  h = await launch(profile)
  await expect(h.chrome.locator('html')).toHaveAttribute('data-flag-retro-screen', '')
  await expect.poll(() => h.chrome.evaluate(() => document.documentElement.style.getPropertyValue('--sc-chroma'))).toBe('0.15')
  expect(await h.chrome.evaluate(() => getComputedStyle(document.body, '::after').pointerEvents)).toBe('none')
  await go(h, 'sc://flags')
  const page = await h.page('sc://flags')
  await expect(page.getByRole('switch', { name: 'Aurora new tab' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('switch', { name: 'Wobbly tabs' }).click()
  await expect(page.getByRole('button', { name: 'Restart now' })).toBeVisible()
  await go(h, 'sc://newtab')
  const tab = await h.page('sc://newtab')
  await expect(tab.locator('.sc-aurora')).toBeVisible()
  await h.chrome.getByRole('combobox', { name: 'Search or enter address' }).pressSequentially('hi')
})

const OPENER = `<!doctype html><title>App</title><script>
  let popup
  addEventListener('message', (e) => { document.title = 'Signed in as ' + e.data })
  function signIn(start) { popup = window.open(start, 'signin', 'width=500,height=600'); return !!popup }
</script>`
const POPUP = `<!doctype html><title>Sign-in window</title><script>
  if (window.opener) { window.opener.postMessage('sam', '*'); window.close() } else document.title = 'No opener'
</script>`

test('a sign-in popup keeps its link to the page, reports back, closes itself and returns to it', async () => {
  const site = await serveSite({ '/opener-page': OPENER, '/signin-window': POPUP, '/stay': '<!doctype html><title>Stays open</title>' })
  h = await launch()
  await go(h, site.url('/opener-page'))
  const app = await h.page('/opener-page')
  await expect(app).toHaveTitle('App')
  const tabs = h.chrome.getByRole('tab')
  const before = await tabs.count()

  // Straight to the address, as some sign-in libraries do.
  expect(await app.evaluate((url) => (window as never as { signIn(u: string): boolean }).signIn(url), site.url('/signin-window'))).toBe(true)
  await expect(app).toHaveTitle('Signed in as sam')
  await expect(tabs).toHaveCount(before)
  await expect(h.chrome.getByRole('tab', { selected: true })).toContainText('Signed in as sam')

  // Starting blank and moving on, as others do.
  await app.evaluate((url) => {
    document.title = 'App'
    const opened = window.open('', 'second', 'width=500,height=600')!
    opened.location.href = url
  }, site.url('/signin-window'))
  await expect(app).toHaveTitle('Signed in as sam')
  await expect(tabs).toHaveCount(before)

  // A popup that stays open shows as an ordinary tab with its address, and the user can close it.
  await app.evaluate((url) => void window.open(url, 'third', 'width=500,height=600'), site.url('/stay'))
  await expect(h.chrome.getByRole('tab', { selected: true })).toContainText('Stays open')
  await expect(tabs).toHaveCount(before + 1)
  await expect(h.chrome.getByRole('combobox', { name: 'Search or enter address' })).toHaveValue(site.url('/stay'))
  site.server.close()
})

test('a noopener link and a popup sent to an sc:// page stay safe', async () => {
  const site = await serveSite({ '/opener-page': OPENER, '/signin-window': POPUP })
  h = await launch()
  await go(h, site.url('/opener-page'))
  const app = await h.page('/opener-page')
  await app.evaluate((url) => void window.open(url, '_blank', 'noopener'), site.url('/signin-window'))
  await expect(h.chrome.getByRole('tab', { selected: true })).toContainText('No opener')
  await h.chrome.getByRole('tab').first().click()
  await app.evaluate(() => {
    const opened = window.open('', 'x', 'width=400,height=400')!
    opened.location.href = 'sc://settings'
  })
  await expect.poll(() => h.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((c) => c.getURL().startsWith('sc://settings')).length)).toBe(0)
  await h.chrome.waitForTimeout(400)
  expect(await h.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((c) => c.getURL().startsWith('sc://settings')).length)).toBe(0)
  site.server.close()
})

test('a site that passes through sign-in on the way still opens, rather than reloading the page before', async () => {
  const titles: Record<string, string> = { '/start': 'Start', '/end': 'Arrived' }
  const server: Server = createServer((req, res) => {
    const host = req.headers.host!
    const port = host.split(':')[1]
    if (req.url === '/through-sign-in') return void res.writeHead(302, { location: `http://signin.test:${port}/pass` }).end()
    if (req.url === '/pass') return void res.writeHead(302, { location: `http://other.test:${port}/end` }).end()
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><title>${titles[req.url!] ?? 'Page'}</title><a id="go" href="http://other.test:${port}/through-sign-in">Go</a>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  h = await launch(undefined, ['--host-resolver-rules=MAP signin.test 127.0.0.1, MAP other.test 127.0.0.1'], { SCB_SIGN_IN_HOST: 'signin.test' })
  await setSetting(h, { httpsOnly: false })
  await go(h, `http://other.test:${port}/start`)
  const page = await h.page('/start')
  await expect(page).toHaveTitle('Start')
  await page.locator('#go').click()
  await expect(h.chrome.getByRole('tab', { selected: true })).toContainText('Arrived')
  await expect(h.chrome.getByRole('combobox', { name: 'Search or enter address' })).toHaveValue(`http://other.test:${port}/end`)
  server.closeAllConnections()
  server.close()
})

