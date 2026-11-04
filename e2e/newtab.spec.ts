import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, serveSite, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

test.beforeEach(async () => {
  mock = await startAiMock()
  site = await serveSite({
    '/alpha': titled('Alpha page')
  })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  mock.server.closeAllConnections()
  mock.server.close()
  site.server.close()
})

const newTab = () => h.page('sc://newtab')

/** Stands in for the system file picker, which tests can't drive. */
const pickFile = (path: string) =>
  h.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
  }, path)

test('widgets can be added, removed, moved and resized, and stay after a restart', async () => {
  const page = await newTab()
  await page.getByRole('button', { name: 'Customise' }).click()
  const panel = page.getByRole('complementary', { name: 'Customise new tab' })

  await panel.getByRole('button', { name: 'Remove Quick AI' }).click()
  await expect(page.getByRole('region', { name: 'Quick AI' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Add Notes' }).click()
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Add Calendar' }).click()
  await panel.getByRole('combobox', { name: 'Calendar width' }).selectOption('half')
  await panel.getByRole('button', { name: 'Move Search up' }).click()
  await panel.getByRole('textbox', { name: 'Your name' }).fill('Sam')
  await panel.getByRole('switch', { name: '24-hour clock' }).click()
  await expect(page.getByRole('heading', { name: /, Sam$/ })).toBeVisible()
  await expect(page.getByRole('timer')).not.toContainText(/AM|PM/i)

  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Buy milk')
  // Notes save shortly after typing stops.
  await expect
    .poll(() => h.chrome.evaluate(() => window.scb.invoke('settings:get').then((s) => (s as { newTab: { notes: string } }).newTab.notes)))
    .toBe('Buy milk')
  await h.close()

  h = await launch(h.profile)
  const again = await newTab()
  await expect(again.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Buy milk')
  await expect(again.getByRole('heading', { name: /, Sam$/ })).toBeVisible()
  await expect(again.getByRole('region', { name: 'Quick AI' })).toHaveCount(0)
  const order = await again.locator('main > div > div').evaluateAll((items) => items.map((item) => item.querySelector('[role=search]') !== null))
  expect(order.indexOf(true)).toBe(1)
})

test('a chosen picture appears, and a fake one is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scb-bg-'))
  const picture = join(dir, 'photo.png')
  const fake = join(dir, 'fake.png')
  writeFileSync(picture, PNG)
  writeFileSync(fake, '<svg onload="alert(1)"></svg>')

  const page = await newTab()
  await page.getByRole('button', { name: 'Customise' }).click()
  const panel = page.getByRole('complementary', { name: 'Customise new tab' })
  await panel.getByRole('combobox', { name: 'Background type' }).selectOption('image')

  await pickFile(fake)
  await panel.getByRole('button', { name: 'Choose' }).click()
  await expect(panel.getByRole('alert')).toContainText('PNG, JPEG')

  await pickFile(picture)
  await panel.getByRole('button', { name: 'Choose' }).click()
  const image = page.locator('img[src^="blob:"]')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
  await expect(page.locator('.sc-newtab')).toHaveAttribute('data-tone', 'light')

})

test('Quick AI answers on the page and carries on in the assistant', async () => {
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

  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  const page = await newTab()
  expect(mock.requests).toHaveLength(0)
  await page.getByRole('textbox', { name: 'Ask a quick question' }).fill('What is rust?')
  await page.getByRole('textbox', { name: 'Ask a quick question' }).press('Enter')
  await expect(page.getByText('Hello there')).toBeVisible()
  expect(mock.requests.at(-1)?.body.messages?.at(-1)?.content).toBe('What is rust?')

  await page.getByRole('button', { name: 'Continue in Assistant' }).click()
  const assistant = await h.page('sc://assistant/?chat=')
  await expect(assistant.getByText('Hello there')).toBeVisible()
})

test('search and shortcuts open in the same tab', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  const page = await newTab()
  const shortcuts = page.getByRole('region', { name: 'Shortcuts' })
  await expect(shortcuts.getByRole('link', { name: /Alpha page/ })).toBeVisible()
  await page.getByRole('combobox', { name: 'Search or enter an address' }).fill(site.url('/alpha'))
  await page.getByRole('combobox', { name: 'Search or enter an address' }).press('Enter')
  await expect(activeTab(h)).toContainText('Alpha page')
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
})

test('the search box suggests bookmarks and history, with keyboard picking', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  const page = await newTab()
  const box = page.getByRole('combobox', { name: 'Search or enter an address' })
  await box.fill('alpha')
  const list = page.getByRole('listbox', { name: 'Suggestions' })
  await expect(list.getByRole('option', { name: /Alpha page/ })).toBeVisible()
  await box.press('ArrowDown')
  await box.press('ArrowDown')
  await box.press('Enter')
  await expect(activeTab(h)).toContainText('Alpha page')
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
})
