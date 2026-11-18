import { expect, test } from '@playwright/test'
import { launch, omnibox as box, serveSite, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

test.beforeEach(async () => {
  site = await serveSite({ '/alpha-page': titled('Alpha page') })
  h = await launch()
})

test.afterEach(async () => {
  await h.close()
  site.server.close()
})

const omnibox = () => box(h)
const selectedText = () => omnibox().evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0))

test('completes a bookmarked address inline, and Backspace takes it away', async () => {
  const alpha = site.url('/alpha-page')
  const host = new URL(alpha).host
  await h.chrome.evaluate((url) => window.scb.invoke('bookmarks:toggle', url, 'Alpha page'), alpha)
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('bookmarks:list').then((list) => list.length))).toBe(1)

  await omnibox().click()
  await omnibox().pressSequentially('127.0')
  await expect(omnibox()).toHaveValue(`${host}/`)
  expect(await selectedText()).toBe(`${host}/`.slice('127.0'.length))

  // Backspace removes the completion and keeps what was typed.
  await omnibox().press('Backspace')
  await expect(omnibox()).toHaveValue('127.0')

  // Typing past the slash completes the whole address, and Enter goes there.
  await omnibox().fill('')
  await omnibox().pressSequentially(`${host}/al`)
  await expect(omnibox()).toHaveValue(alpha.replace(/^http:\/\//, ''))
  await omnibox().press('Enter')
  await expect(h.chrome.getByRole('tab', { selected: true })).toHaveText('Alpha page')
})

test('shows the answer to a typed sum and copies it', async () => {
  const overlay = await h.overlay()
  await omnibox().click()
  await omnibox().pressSequentially('7*8')
  const row = overlay.getByRole('option', { name: /7\*8 = 56/ })
  await expect(row).toBeVisible()
  await h.app.evaluate(({ clipboard }) => clipboard.writeText(''))
  await row.dispatchEvent('mousedown', { button: 0 })
  await expect.poll(() => h.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('56')
})
