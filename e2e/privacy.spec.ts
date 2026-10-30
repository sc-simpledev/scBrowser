import { expect, test } from '@playwright/test'
import { activeTab, go, launch, omnibox, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

const article = `<article><h2>The story</h2>${'<p>Reader view keeps the words and drops everything else around them, which makes long pieces easier to finish.</p>'.repeat(8)}<img src="x" onerror="if(location.protocol==='sc:')document.title='hacked'"><script>if(location.protocol==='sc:')document.title='hacked'</script></article>`

test.beforeEach(async () => {
  site = await serveSite({
    '/tracked': titled('Tracked', '<script src="http://localhost:9/tracker.js"></script><img src="http://localhost:9/tracker.js?2">'),
    '/story': titled('Story', article)
  })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

test('blocks trackers, counts them, and can be turned off per site', async () => {
  h = await launch()
  await go(h, site.url('/tracked'))
  await expect(activeTab(h)).toHaveText('Tracked')
  const shield = h.chrome.getByRole('button', { name: '2 blocked. Turn off for this site' })
  await expect(shield).toBeVisible()
  await shield.click()
  await expect(h.chrome.getByRole('button', { name: 'Tracking protection is off here' })).toBeVisible()
})

test('moves http pages to https, and offers plain http when that fails', async () => {
  h = await launch(undefined, ['--host-resolver-rules=MAP scb.test 127.0.0.1'])
  const address = site.url('/story').replace('127.0.0.1', 'scb.test')
  await go(h, address)
  await expect(activeTab(h)).toHaveText("This page didn't load")
  await expect(omnibox(h)).toHaveValue(address.replace('http:', 'https:'))

  const error = await h.page('sc://error')
  await error.getByRole('button', { name: 'Continue without HTTPS' }).click()
  await expect(activeTab(h)).toHaveText('Story')
  await expect(omnibox(h)).toHaveValue(address)
})

test('reader view shows the article, with no page scripts, and back', async () => {
  h = await launch()
  await go(h, site.url('/story'))
  await expect(activeTab(h)).toHaveText('Story')
  await h.chrome.getByRole('button', { name: 'Reader view' }).click()
  const reader = await h.page('sc://reader')
  await expect(reader.getByText('The story')).toBeVisible()
  await expect(reader.locator('script')).toHaveCount(0)
  await expect(omnibox(h)).toHaveValue(site.url('/story'))
  await reader.waitForTimeout(300)
  await expect(activeTab(h)).not.toContainText('hacked')
  expect(await reader.evaluate(() => 'scbInternal' in window && document.scripts.length)).toBe(0)

  await h.chrome.getByRole('button', { name: 'Leave reader view' }).click()
  await expect(h.chrome.getByRole('button', { name: 'Reader view' })).toBeVisible()
})

test('command palette finds and runs a command', async () => {
  h = await launch()
  await shortcut(h, 'k')
  const overlay = await h.overlay()
  const input = overlay.getByRole('combobox', { name: 'Type a command' })
  await expect(input).toBeVisible()
  await input.fill('hist')
  await expect(overlay.getByRole('option')).toHaveCount(1)
  await input.press('Enter')
  await h.page('sc://history')
  await expect(input).toHaveCount(0)

  await shortcut(h, 'k')
  await expect(input).toBeVisible()
  await input.press('Escape')
  await expect(input).toHaveCount(0)
})

test('accent colour applies to the interface', async () => {
  h = await launch()
  await setSetting(h, { accent: 'ocean' })
  await expect.poll(() => h.chrome.evaluate(() => document.documentElement.dataset.accent)).toBe('ocean')
})
