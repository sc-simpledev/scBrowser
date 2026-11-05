import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTab, go, launch, newProfile, serveSite, setSetting, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>
const snapshot = () => main((g) => g.scbTabs.snapshot()) as Promise<{ tabs: { id: number; group: string | null; isSleeping: boolean }[]; activeId: number }>

test.beforeEach(async () => {
  site = await serveSite({ '/alpha': titled('Alpha page'), '/beta': titled('Beta page'), '/gamma': titled('Gamma page'), '/dark': '<!doctype html><title>Dark page</title><body style="background:#111;color:#eee">Dark</body>' })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

async function threeTabs() {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  for (const [path, title] of [['/beta', 'Beta page'], ['/gamma', 'Gamma page']]) {
    await main((g, url: string) => g.scbTabs.create(url), site.url(path))
    await expect(activeTab(h)).toContainText(title)
  }
  return (await snapshot()).tabs.map((tab) => tab.id)
}

test('tabs can be grouped by hand, renamed, folded and taken out again', async () => {
  h = await launch()
  await setSetting(h, { tabLayout: 'vertical', verticalTabsCollapsed: false })
  const [alpha, beta, gamma] = await threeTabs()
  await h.chrome.evaluate((id) => window.scb.invoke('tabs:set-group', id, ''), alpha!)
  await h.chrome.evaluate((id) => window.scb.invoke('tabs:set-group', id, 'Group 1'), gamma!)
  // Joining a group brings the tab next to the others in it.
  await expect.poll(async () => (await snapshot()).tabs.map((tab) => [tab.id, tab.group])).toEqual([[alpha, 'Group 1'], [gamma, 'Group 1'], [beta, null]])
  const header = h.chrome.getByRole('button', { name: /Group 1 group, 2 tabs/ })
  await expect(header).toBeVisible()

  await header.dblclick()
  const name = h.chrome.getByRole('textbox', { name: 'Group name' })
  await name.fill('Reading')
  await name.press('Enter')
  const renamed = h.chrome.getByRole('button', { name: /Reading group, 2 tabs/ })
  await expect(renamed).toHaveAttribute('aria-expanded', 'true')

  // The open tab stays in view while its group is folded.
  await h.chrome.getByRole('tab', { name: 'Beta page' }).dispatchEvent('mousedown')
  await expect(activeTab(h)).toContainText('Beta page')
  await renamed.click()
  await expect(renamed).toHaveAttribute('aria-expanded', 'false')
  await expect(h.chrome.getByRole('tab', { name: 'Alpha page' })).toHaveCount(0)
  await expect(h.chrome.getByRole('tab', { name: 'Gamma page' })).toHaveCount(0)
  await renamed.click()
  await expect(h.chrome.getByRole('tab', { name: 'Alpha page' })).toBeVisible()

  await h.chrome.evaluate((id) => window.scb.invoke('tabs:set-group', id, null), alpha!)
  await expect.poll(async () => (await snapshot()).tabs.find((tab) => tab.id === alpha)!.group).toBeNull()
})

test('the sleep button is off by default, and puts a tab to sleep when turned on', async () => {
  h = await launch()
  await setSetting(h, { tabLayout: 'vertical', verticalTabsCollapsed: false })
  const [alpha] = await threeTabs()
  await expect(h.chrome.getByRole('button', { name: 'Sleep tab' })).toHaveCount(0)
  await setSetting(h, { tabSleepButton: true })
  const tab = h.chrome.getByRole('tab', { name: 'Alpha page' })
  await tab.getByRole('button', { name: 'Sleep tab' }).click()
  await expect.poll(async () => (await snapshot()).tabs.find((other) => other.id === alpha)!.isSleeping).toBe(true)
  // The open tab hands over to a neighbour before it sleeps.
  await activeTab(h).getByRole('button', { name: 'Sleep tab' }).click()
  await expect.poll(async () => (await snapshot()).tabs.filter((other) => other.isSleeping).length).toBe(2)
  await expect(activeTab(h)).toContainText('Beta page')
})

test('bookmarks can go down the side as icons and folders, and are along the top by default', async () => {
  h = await launch()
  await setSetting(h, { tabLayout: 'horizontal' })
  await h.chrome.evaluate(async (urls) => {
    await window.scb.invoke('bookmarks:toggle', urls[0], 'Alpha')
    await window.scb.invoke('bookmarks:toggle', urls[1], 'Beta')
  }, [site.url('/alpha'), site.url('/beta')])
  await expect(h.chrome.getByRole('toolbar', { name: 'Bookmarks' })).toBeVisible()
  await setSetting(h, { bookmarksLayout: 'vertical' })
  await expect(h.chrome.getByRole('toolbar', { name: 'Bookmarks' })).toHaveCount(0)
  const side = h.chrome.getByRole('navigation', { name: 'Bookmarks' })
  await expect(side).toBeVisible()
  await side.getByRole('button', { name: 'Beta' }).click()
  await expect(activeTab(h)).toContainText('Beta page')
  await setSetting(h, { tabLayout: 'vertical', verticalTabsCollapsed: false })
  await expect(h.chrome.getByRole('complementary', { name: 'Bookmarks sidebar' })).toHaveCount(0)
  await expect(side).toBeVisible()
})

test('the PDF viewer has its own print box, which can save chosen pages as a PDF', async () => {
  h = await launch()
  await go(h, site.url('/report.pdf'))
  const page = await h.page('sc://pdf')
  await expect(page.getByRole('toolbar', { name: 'PDF' })).toContainText('of 1')
  await page.getByRole('button', { name: 'Print' }).click()
  const box = page.getByRole('dialog', { name: 'Print' })
  await expect(box).toBeVisible()
  await expect(box.getByRole('combobox', { name: 'Destination' })).toContainText('Save as PDF')
  await expect(box.getByRole('figure')).toHaveCount(1)
  await box.getByRole('radio', { name: 'Custom' }).click()
  await box.getByRole('textbox', { name: 'Page range' }).fill('2')
  // A page the document doesn't have can't be printed.
  await expect(box.getByRole('textbox', { name: 'Page range' })).toHaveAttribute('aria-invalid', 'true')
  await expect(box.getByRole('button', { name: /^(Print|Save)$/ })).toBeDisabled()
  await box.getByRole('textbox', { name: 'Page range' }).fill('1')
  await box.getByRole('combobox', { name: 'Destination' }).selectOption('pdf')
  const folder = mkdtempSync(join(tmpdir(), 'scb-print-'))
  const out = join(folder, 'chosen.pdf')
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
  }, out)
  await box.getByRole('button', { name: 'Save' }).click()
  await expect(box).toHaveCount(0)
  await expect.poll(() => existsSync(out)).toBe(true)
  expect(readFileSync(out).subarray(0, 5).toString()).toBe('%PDF-')
})

test('force dark pages darkens light pages and leaves dark ones alone', async () => {
  const profile = newProfile()
  writeFileSync(join(profile, 'flags.json'), JSON.stringify(['force-dark-pages', 'snowfall', 'rainbow-loading']))
  h = await launch(profile)
  await go(h, site.url('/alpha'))
  const light = await h.page('/alpha')
  await expect.poll(() => light.evaluate(() => getComputedStyle(document.documentElement).filter)).toContain('invert(1)')
  await go(h, site.url('/dark'))
  const dark = await h.page('/dark')
  await expect(dark).toHaveTitle('Dark page')
  await h.chrome.waitForTimeout(300)
  expect(await dark.evaluate(() => getComputedStyle(document.documentElement).filter)).toBe('none')
  await expect(h.chrome.locator('html')).toHaveAttribute('data-flag-rainbow-loading', '')
})

test('a vault can be made without a master password, and opens by itself', async () => {
  const profile = newProfile()
  h = await launch(profile)
  await go(h, 'sc://passwords')
  let page = await h.page('sc://passwords')
  await page.getByRole('radio', { name: /No master password/ }).check()
  await page.getByRole('button', { name: 'Create vault' }).click()
  await expect(page.getByLabel('Logins')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lock' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add a master password' })).toBeVisible()
  await h.close()
  h = await launch(profile)
  await go(h, 'sc://passwords')
  page = await h.page('sc://passwords')
  await expect(page.getByLabel('Logins')).toBeVisible()
})
