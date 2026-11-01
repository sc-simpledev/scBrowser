import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTab, go, launch, omnibox, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

test.beforeEach(async () => {
  site = await serveSite({
    '/alpha': titled('Alpha page', '<p>needle and another needle</p>'),
    '/beta': titled('Beta page'),
    '/gamma': titled('Gamma page'),
    '/download': titled('Files', '<a id="dl" href="/file.txt">get</a>'),
    '/notify': titled('Notify', '<button id="ask" onclick="Notification.requestPermission().then(r => document.title = r)">ask</button>'),
    '/attack': titled('Attack')
  })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

const newTab = async () => {
  const before = await h.chrome.getByRole('tab').count()
  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  await expect(h.chrome.getByRole('tab')).toHaveCount(before + 1)
}

test('restores the session lazily, with back history', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toHaveText('Alpha page')
  await go(h, site.url('/beta'))
  await expect(activeTab(h)).toHaveText('Beta page')
  await newTab()
  await go(h, site.url('/gamma'))
  await expect(activeTab(h)).toHaveText('Gamma page')
  await h.close()

  h = await launch(h.profile)
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  await expect(activeTab(h)).toHaveText('Gamma page')
  await expect(h.chrome.getByRole('tab', { name: 'Beta page' })).toBeVisible()

  // The other tab stays unloaded until it's opened.
  expect(h.app.windows().some((p) => p.url().includes('/beta'))).toBe(false)
  await h.chrome.getByRole('tab', { name: 'Beta page' }).click()
  await expect(omnibox(h)).toHaveValue(site.url('/beta'))
  const back = h.chrome.getByRole('button', { name: 'Back' })
  await expect(back).toBeEnabled()
  await back.click()
  await expect(activeTab(h)).toHaveText('Alpha page')
})

test('sleeps background tabs and wakes them on demand', async () => {
  await go(h, site.url('/alpha'))
  await newTab()
  await go(h, site.url('/beta'))
  await expect(activeTab(h)).toHaveText('Beta page')
  await h.app.evaluate(() => (globalThis as unknown as { scbTabs: { sleepIdle(ms: number): void } }).scbTabs.sleepIdle(-1))
  await expect.poll(() => h.app.windows().some((p) => p.url().includes('/alpha'))).toBe(false)
  await expect(h.chrome.getByRole('tab', { name: 'Alpha page' })).toBeVisible()
  await h.chrome.getByRole('tab', { name: 'Alpha page' }).click()
  await expect(omnibox(h)).toHaveValue(site.url('/alpha'))
  await h.page('/alpha')
})

test('bookmarks a page, shows it in the bar and in suggestions', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toHaveText('Alpha page')
  await h.chrome.getByRole('button', { name: 'Bookmark this page' }).click()
  await expect(h.chrome.getByRole('button', { name: 'Edit bookmark' })).toBeVisible()

  const bar = h.chrome.getByRole('toolbar', { name: 'Bookmarks' })
  await go(h, site.url('/beta'))
  await expect(activeTab(h)).toHaveText('Beta page')
  await bar.getByRole('button', { name: 'Alpha page' }).click()
  await expect(activeTab(h)).toHaveText('Alpha page')
})

test('finds text in the page', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toHaveText('Alpha page')
  await shortcut(h, 'f')
  const find = h.chrome.getByRole('textbox', { name: 'Find in page' })
  await expect(find).toBeFocused()
  await find.fill('needle')
  await expect(h.chrome.getByText('1 of 2')).toBeVisible()
  await find.press('Enter')
  await expect(h.chrome.getByText('2 of 2')).toBeVisible()
  await find.press('Escape')
  await expect(find).toHaveCount(0)
})

test('zooms and resets', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toHaveText('Alpha page')
  await shortcut(h, '=')
  const pill = h.chrome.getByRole('button', { name: /Zoom 110%/ })
  await expect(pill).toBeVisible()
  await pill.click()
  await expect(pill).toHaveCount(0)
})

test('reorders tabs by dragging and supports vertical tabs', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toHaveText('Alpha page')
  await newTab()
  await go(h, site.url('/beta'))
  await expect(activeTab(h)).toHaveText('Beta page')

  // Vertical is the default.
  await expect(h.chrome.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
  await h.chrome.getByRole('tab', { name: 'Beta page' }).dragTo(h.chrome.getByRole('tab', { name: 'Alpha page' }), {
    targetPosition: { x: 20, y: 5 }
  })
  await expect(h.chrome.getByRole('tab').first()).toHaveText('Beta page')

  await setSetting(h, { tabLayout: 'horizontal' })
  await expect(h.chrome.getByRole('tablist')).not.toHaveAttribute('aria-orientation', 'vertical')
  await h.chrome.getByRole('tab', { name: 'Alpha page' }).dragTo(h.chrome.getByRole('tab', { name: 'Beta page' }), {
    targetPosition: { x: 5, y: 10 }
  })
  await expect(h.chrome.getByRole('tab').first()).toHaveText('Alpha page')

  await setSetting(h, { tabLayout: 'vertical' })
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  await h.chrome.getByRole('button', { name: 'Collapse tabs' }).click()
  await expect(h.chrome.getByRole('button', { name: 'Expand tabs' })).toBeVisible()
})

test('closes a side tab from its favicon, expanded or collapsed', async () => {
  await newTab()
  await newTab()
  const closeFirst = h.chrome.getByRole('tab').first().getByRole('button', { name: 'Close tab' })
  await closeFirst.click()
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)

  await h.chrome.getByRole('button', { name: 'Collapse tabs' }).click()
  await closeFirst.click()
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
})

test('shows two tabs side by side and ends the split', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toHaveText('Alpha page')
  await newTab()
  await go(h, site.url('/beta'))
  await expect(activeTab(h)).toHaveText('Beta page')

  const bounds = () =>
    h.app.evaluate(() => {
      const tabs = (globalThis as unknown as { scbTabs: { snapshot(): { splitIds: number[] } } }).scbTabs
      return tabs.snapshot().splitIds.length
    })
  await h.app.evaluate(() => (globalThis as unknown as { scbTabs: { toggleSplit(): void } }).scbTabs.toggleSplit())
  await expect.poll(bounds).toBe(2)

  // Using the other page moves the address bar to it.
  await h.app.evaluate(({ webContents }) => {
    webContents.getAllWebContents().find((c) => c.getURL().includes('/alpha'))?.focus()
  })
  await expect(omnibox(h)).toHaveValue(site.url('/alpha'))
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)

  // Opening anything else ends the split.
  await newTab()
  await expect.poll(bounds).toBe(0)
})

test('settings page changes the search engine', async () => {
  await go(h, 'sc://settings')
  const page = await h.page('sc://settings')
  await page.getByRole('combobox', { name: 'Search engine' }).selectOption('google')
  await page.getByRole('combobox', { name: 'Tab layout' }).selectOption('vertical')
  await expect(h.chrome.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')

  await omnibox(h).click()
  await omnibox(h).fill('hello world')
  const overlay = await h.overlay()
  await expect(overlay.getByRole('option', { name: /Search Google/ })).toBeVisible()
  await omnibox(h).press('Escape')
})

test('history page lists and removes visits', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toHaveText('Alpha page')
  await shortcut(h, 'h')
  const page = await h.page('sc://history')
  const link = page.getByRole('link', { name: 'Alpha page' })
  await expect(link).toBeVisible()
  await link.hover()
  await page.getByRole('button', { name: 'Remove from history' }).click()
  await expect(link).toHaveCount(0)
})

test('downloads a file and lists it', async () => {
  await setSetting(h, { downloadDir: h.profile })
  await go(h, site.url('/download'))
  const tab = await h.page('/download')
  await tab.locator('#dl').click()
  const file = join(h.profile, 'file.txt')
  await expect.poll(() => existsSync(file)).toBe(true)
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('downloaded content')

  await h.chrome.getByRole('button', { name: /^Downloads/ }).click()
  const page = await h.page('sc://downloads')
  await expect(page.getByText('file.txt')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show in folder' })).toBeVisible()
})

test('asks for permission once and remembers the answer', async () => {
  await go(h, site.url('/notify'))
  const tab = await h.page('/notify')
  await tab.locator('#ask').click()
  const overlay = await h.overlay()
  const prompt = overlay.getByRole('alertdialog')
  await expect(prompt).toContainText('wants to show notifications')
  await prompt.getByRole('button', { name: 'Allow' }).click()
  await expect(activeTab(h)).toHaveText('granted')
  await expect(prompt).toHaveCount(0)

  await tab.reload()
  await tab.locator('#ask').click()
  await expect(activeTab(h)).toHaveText('granted')
  await expect(prompt).toHaveCount(0)

  await go(h, 'sc://settings')
  const settings = await h.page('sc://settings')
  await expect(settings.getByText('Allowed to show notifications')).toBeVisible()
})

test('websites cannot reach privileged pages', async () => {
  await go(h, site.url('/attack'))
  await expect(activeTab(h)).toHaveText('Attack')
  const tab = await h.page('/attack')

  expect(await tab.evaluate(() => 'scbInternal' in window || 'scb' in window)).toBe(false)

  await tab.evaluate(() => {
    location.href = 'sc://settings'
  })
  await tab.evaluate(() => window.open('sc://settings'))
  await tab.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.src = 'sc://settings'
    document.body.append(frame)
  })
  await tab.waitForTimeout(500)
  await expect(omnibox(h)).toHaveValue(site.url('/attack'))
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
  expect(tab.frames().filter((f) => f.url().startsWith('sc:'))).toEqual([])
})

test('shows an error page that keeps the failed address', async () => {
  const dead = 'http://127.0.0.1:9/nowhere'
  await go(h, dead)
  await expect(activeTab(h)).toHaveText("This page didn't load")
  await expect(omnibox(h)).toHaveValue(dead)
})

test('recovers a crashed page', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toHaveText('Alpha page')
  await h.app.evaluate(({ webContents }) => {
    webContents.getAllWebContents().find((c) => c.getURL().includes('/alpha'))?.forcefullyCrashRenderer()
  })
  await expect(activeTab(h)).toHaveText("This page didn't load")
  await expect(omnibox(h)).toHaveValue(site.url('/alpha'))
})
