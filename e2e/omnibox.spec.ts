import { expect, test } from '@playwright/test'
import { go as goTo, launch, omnibox as box, serveSite, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

test.beforeEach(async () => {
  site = await serveSite({ '/alpha': titled('Alpha page'), '/beta': titled('Beta page') })
  h = await launch()
})

test.afterEach(async () => {
  await h.close()
  site.server.close()
})

const omnibox = () => box(h)
const go = (address: string) => goTo(h, address)

test('navigates, remembers history and offers it as suggestions', async () => {
  await go(site.url('/alpha'))
  await expect(h.chrome.getByRole('tab', { selected: true })).toHaveText('Alpha page')
  await go(site.url('/beta'))
  await expect(h.chrome.getByRole('tab', { selected: true })).toHaveText('Beta page')

  // In a second tab, "alpha" is only in history; "beta" is the other open tab.
  await h.chrome.getByRole('button', { name: 'New tab' }).click()
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  await expect(omnibox()).toBeFocused()

  const overlay = await h.overlay()
  await omnibox().pressSequentially('alpha')
  const historyRow = overlay.getByRole('option', { name: /Alpha page/ })
  await expect(historyRow).toBeVisible()

  await omnibox().press('ArrowDown')
  await expect(historyRow).toHaveAttribute('aria-selected', 'true')
  await omnibox().press('Enter')
  await expect(h.chrome.getByRole('tab', { selected: true })).toHaveText('Alpha page')

  await omnibox().click()
  await omnibox().fill('')
  await omnibox().pressSequentially('beta')
  const tabRow = overlay.getByRole('option', { name: /Beta page.*Switch to tab/ })
  await expect(tabRow).toBeVisible()
  await tabRow.dispatchEvent('mousedown', { button: 0 })
  await expect(h.chrome.getByRole('tab', { selected: true })).toHaveText('Beta page')
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
})

test('Escape closes the dropdown, then restores the URL', async () => {
  await go(site.url('/alpha'))
  await omnibox().click()
  await omnibox().fill('something else')
  const overlay = await h.overlay()
  await expect(overlay.getByRole('listbox')).toBeVisible()

  await omnibox().press('Escape')
  await expect(overlay.getByRole('listbox')).toHaveCount(0)
  await expect(omnibox()).toHaveValue('something else')

  await omnibox().press('Escape')
  await expect(omnibox()).toHaveValue(site.url('/alpha'))
})

test('a new tab leaves the keyboard in the address bar', async () => {
  await h.chrome.getByRole('button', { name: 'New tab' }).click()
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  await h.chrome.waitForTimeout(700)
  const focused = await h.app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL() ?? 'none')
  expect(focused).toContain('renderer/index.html')
  await expect(omnibox()).toBeFocused()
})
