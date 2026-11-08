import { expect, test } from '@playwright/test'
import { go, launch, setSetting, type Harness } from './app'

let h: Harness
test.beforeAll(async () => {
  h = await launch()
})
test.afterAll(() => h.close())

test('settings show one page at a time, picked from the sidebar or the address', async () => {
  await go(h, 'sc://settings')
  const page = await h.page('sc://settings')
  const nav = page.getByRole('navigation')
  await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Search engine' })).toHaveCount(0)
  await nav.getByRole('link', { name: 'Privacy and security' }).click()
  await expect(page.getByRole('heading', { name: 'Privacy and security', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Privacy and security' })).toHaveAttribute('aria-current', 'page')
  expect(page.url()).toContain('#privacy')
  // A menu that opens a part of Settings goes straight to it, in the same tab.
  await h.app.evaluate(() => (globalThis as never as { scbActions: { openPage: (page: string, part: string) => void } }).scbActions.openPage('settings', 'data'))
  await expect(page.getByRole('heading', { name: 'Your data', level: 2 })).toBeVisible()
})

test('search finds settings on every page, by name, description or a related word', async () => {
  await go(h, 'sc://settings/#about')
  const page = await h.page('sc://settings')
  const search = page.getByRole('searchbox', { name: 'Search settings' })
  await search.fill('dark mode')
  await expect(page.getByRole('combobox', { name: 'Theme' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Tab layout' })).toHaveCount(0)
  // Nothing in the sidebar claims to be the open page while results come from all of them.
  await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toHaveCount(1)

  // Words from a hint count, across pages.
  await search.fill('memory')
  await expect(page.getByRole('switch', { name: 'Memory saver' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Sleep button on tabs' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Theme' })).toBeHidden()

  // A section's name brings all of it.
  await search.fill('downloads')
  await expect(page.getByRole('switch', { name: 'Ask where to save each file' })).toBeVisible()

  await search.fill('qqqzzz')
  await expect(page.getByRole('status')).toContainText('No settings match')
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(page.getByRole('heading', { name: 'About', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toHaveCount(0)
})

test('toolbar buttons and address bar suggestions are toggled in one row each', async () => {
  await setSetting(h, { hiddenToolbarItems: [] })
  await go(h, 'sc://settings/#tabs')
  const page = await h.page('sc://settings')
  const buttons = page.getByRole('group', { name: 'Toolbar buttons' })
  await buttons.getByRole('button', { name: 'Reader view' }).click()
  await expect(buttons.getByRole('button', { name: 'Reader view' })).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('settings:get').then((s) => s.hiddenToolbarItems))).toEqual(['reader'])
  // Two quick changes in a row both stick.
  await buttons.getByRole('button', { name: 'Assistant' }).click()
  await buttons.getByRole('button', { name: 'Reader view' }).click()
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('settings:get').then((s) => s.hiddenToolbarItems))).toEqual(['assistant'])
})
