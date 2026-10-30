import { expect, test } from '@playwright/test'
import { launch, serveSite, type Harness } from './app'

let h: Harness
let site: Awaited<ReturnType<typeof serveSite>>

test.beforeEach(async () => {
  site = await serveSite({ '/alpha': 'Alpha page', '/beta': 'Beta page' })
  h = await launch()
})

test.afterEach(async () => {
  await h.close()
  site.server.close()
})

const omnibox = () => h.chrome.getByRole('combobox', { name: 'Search or enter address' })

async function go(address: string) {
  await omnibox().click()
  await omnibox().fill(address)
  await omnibox().press('Enter')
}

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
