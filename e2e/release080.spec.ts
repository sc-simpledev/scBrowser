import { expect, test } from '@playwright/test'
import { go, launch, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
test.beforeAll(async () => {
  site = await serveSite({ '/a': titled('Alpha'), '/b': titled('Beta'), '/c': titled('Gamma') })
})
test.afterAll(() => site.server.close())
test.beforeEach(async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
})
test.afterEach(() => h.close())

const invoke = (channel: string, ...args: unknown[]) =>
  h.chrome.evaluate(([name, rest]) => (window as unknown as { scb: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).scb.invoke(name as string, ...(rest as unknown[])), [channel, args] as const)

test('the focus timer starts with Space, takes a break with B, and its sound can be chosen', async () => {
  await go(h, 'sc://focus')
  const page = await h.page('sc://focus')
  await expect(page.getByRole('heading', { name: 'Focus timer' })).toBeVisible()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /Stop/ }).first()).toBeVisible()
  await page.keyboard.press('b')
  await expect(page.getByText('On a break')).toBeVisible()
  await expect(page.getByText('The timer starts again by itself')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /Start/ }).first()).toBeVisible()

  await page.getByRole('button', { name: /Timer settings/ }).click()
  await page.getByRole('combobox', { name: 'Sound at the end of a round' }).selectOption('bell')
  await expect(page.getByRole('slider', { name: 'Sound volume' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Sound at the end of a round' }).selectOption('none')
  await expect(page.getByRole('slider', { name: 'Sound volume' })).toHaveCount(0)
})

test('History folds a site visited three times, and opens it to show each page', async () => {
  for (const path of ['/a', '/b', '/c']) await go(h, site.url(path))
  await go(h, 'sc://history')
  const page = await h.page('sc://history')
  const fold = page.getByRole('button', { name: /3 pages/ })
  await expect(fold).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta' })).toHaveCount(0)
  await fold.click()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeVisible()
  // A search lists every match on its own.
  await page.getByRole('textbox', { name: 'Search history' }).fill('Gamma')
  await expect(page.getByRole('link', { name: 'Gamma' })).toBeVisible()
  await expect(page.getByRole('button', { name: /pages/ })).toHaveCount(0)
})

test('Tidy up finds a bookmark saved twice and removes the copy only when asked', async () => {
  await invoke('bookmarks:toggle', site.url('/a'), 'Alpha')
  await invoke('bookmarks:toggle', `${site.url('/a')}#top`, 'Alpha again')
  await invoke('bookmarks:toggle', site.url('/missing'), 'Missing')
  await go(h, 'sc://bookmarks')
  const page = await h.page('sc://bookmarks')
  await page.getByRole('button', { name: /Tidy up/ }).click()
  const tidy = page.getByRole('region', { name: 'Tidy up bookmarks' })
  await expect(tidy).toContainText('Alpha again')
  await tidy.getByRole('button', { name: /Check 3 links/ }).click()
  await expect(tidy.getByRole('list', { name: 'Pages that are gone' })).toContainText('Missing')
  await expect(tidy.getByRole('list', { name: 'Pages that are gone' })).toContainText('Answered 404')
  await expect(page.getByRole('link', { name: 'Alpha again' })).toHaveCount(2)
  await tidy.getByRole('listitem').filter({ hasText: 'Alpha again' }).getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('link', { name: 'Alpha again' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Alpha', exact: true })).toHaveCount(1)
})

test('Settings search jumps to a setting on its page, and a page resets to its defaults', async () => {
  await setSetting(h, { accentTint: true, bookmarksBar: 'new-tab' })
  await go(h, 'sc://settings/#privacy')
  const page = await h.page('sc://settings')
  await page.getByRole('textbox', { name: /Search settings/ }).or(page.getByRole('searchbox')).first().fill('accent tint')
  await page.getByRole('button', { name: 'Accent tint', exact: true }).click()
  await expect(page).toHaveURL(/#appearance$/)
  await expect(page.locator('[data-setting-label="Accent tint"]')).toHaveClass(/sc-flash/)
  await expect(page.getByRole('switch', { name: 'Accent tint' })).toBeFocused()
  await page.getByRole('button', { name: 'Reset this page to defaults' }).click()
  await page.getByRole('button', { name: 'Reset all 2?' }).click()
  await expect.poll(async () => ((await invoke('settings:get')) as { accentTint: boolean }).accentTint).toBe(false)
  await expect(page.getByRole('button', { name: 'Reset this page to defaults' })).toHaveCount(0)
})

test('the command palette offers to ask scAI when nothing matches, and the new tab hides a removed shortcut', async () => {
  await shortcut(h, 'k')
  const overlay = await h.overlay()
  await overlay.getByRole('combobox', { name: 'Type a command' }).fill('qzxv')
  await expect(overlay.getByRole('option', { name: /Ask scAI: “qzxv”/ })).toBeVisible()
  await overlay.getByRole('combobox', { name: 'Type a command' }).press('Escape')

  for (const path of ['/a', '/b']) await go(h, site.url(path))
  await go(h, 'sc://newtab')
  const page = await h.page('sc://newtab')
  const tile = page.getByRole('link', { name: /Alpha/ })
  await expect(tile).toBeVisible()
  await tile.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin in place' }).click()
  await expect(page.getByRole('img', { name: 'Pinned' })).toHaveCount(1)
  await page.getByRole('link', { name: /Beta/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Remove from shortcuts' }).click()
  await expect(page.getByRole('link', { name: /Beta/ })).toHaveCount(0)
  const { newTab } = (await invoke('settings:get')) as { newTab: { links: { url: string }[]; hiddenSites: string[] } }
  expect(newTab.links.map((link) => link.url)).toEqual([site.url('/a')])
  expect(newTab.hiddenSites).toEqual([site.url('/b')])
})
