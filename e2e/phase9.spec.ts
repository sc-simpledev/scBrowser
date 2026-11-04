import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { go, launch, newProfile, setSetting, type Harness } from './app'

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
  await page.getByRole('button', { name: 'Remove One' }).hover()
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

test('only Google sign-in pages are told this is Firefox, in headers and to scripts', async () => {
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
  await expect.poll(() => seen['signin.test']?.['user-agent']).toContain('Firefox/')
  expect(Object.keys(seen['signin.test']!).filter((name) => name.startsWith('sec-ch-ua'))).toEqual([])
  await expect.poll(() => page.evaluate(() => navigator.userAgent)).toContain('Firefox/')

  await go(h, `http://other.test:${port}/`)
  const other = await h.page('other.test')
  await expect.poll(() => seen['other.test']?.['user-agent']).toContain('Chrome/')
  expect(seen['other.test']!['user-agent']).not.toContain('Firefox')
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
