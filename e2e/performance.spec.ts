import { expect, test } from '@playwright/test'
import { activeTab, go, launch, serveSite, setSetting, titled, type Harness, type Site } from './app'

const MINUTE = 60_000
/** A moment of silence, so a press-free `play()` has something to try. */
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
const tabStates = (h: Harness) =>
  h.app.evaluate(() => (globalThis as unknown as { scbTabs: { snapshot(): { tabs: { url: string; isSleeping: boolean; pinned: boolean }[] } } }).scbTabs.snapshot().tabs)
const shiftClock = (h: Harness, by: number) =>
  h.app.evaluate((_electron, ms) => {
    const real = Date.now
    Date.now = () => real() + ms
  }, by)

test.describe('Performance Mode', () => {
  let h: Harness
  let site: Site
  test.beforeAll(async () => {
    site = await serveSite({ '/a': titled('Page A'), '/b': titled('Page B') })
  })
  test.afterAll(() => site.server.close())
  test.afterEach(() => h.close())

  test('the switch plainly draws the browser and is saved', async () => {
    h = await launch()
    await go(h, 'sc://settings/#performance')
    const page = await h.page('sc://settings')
    await expect(page.locator('html')).not.toHaveAttribute('data-performance')
    await page.getByRole('switch', { name: 'Performance Mode' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-performance', '')
    await expect(h.chrome.locator('html')).toHaveAttribute('data-performance', '')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sc-duration-fast').trim())).toMatch(/^0m?s$/)
  })

  test('sleeps background tabs sooner than the setting, even set to Never', async () => {
    h = await launch(undefined, [], { SCB_SLEEP_CHECK_MS: '200' })
    await setSetting(h, { sleepAfterMinutes: 0 })
    await go(h, site.url('/a'))
    await h.chrome.evaluate(() => window.scb.invoke('tabs:create', 'sc://history'))
    await shiftClock(h, 6 * MINUTE)
    // Off: Never means never.
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect((await tabStates(h)).find((tab) => tab.url.includes('/a'))?.isSleeping).toBe(false)
    await setSetting(h, { performanceMode: true })
    await expect.poll(async () => (await tabStates(h)).find((tab) => tab.url.includes('/a'))?.isSleeping).toBe(true)
  })

  test('new pages wait for a press before playing, only while it is on', async () => {
    // From the main process and with no gesture, as Playwright's own `evaluate` counts as a press.
    const tryPlaying = (fragment: string) =>
      h.app.evaluate(
        (_electron, { fragment, src }) => {
          const tabs = (globalThis as unknown as { scbTabs: { snapshot(): { tabs: { id: number; url: string }[] }; contentsFor(id: number): Electron.WebContents } }).scbTabs
          const { id } = tabs.snapshot().tabs.find((tab) => tab.url.includes(fragment))!
          return tabs.contentsFor(id).executeJavaScript(`new Audio(${JSON.stringify(src)}).play().then(() => 'played', (error) => error.name)`, false)
        },
        { fragment, src: SILENCE }
      )
    h = await launch()
    await go(h, site.url('/a'))
    await expect(activeTab(h)).toContainText('Page A')
    expect(await tryPlaying('/a')).not.toBe('NotAllowedError')
    await setSetting(h, { performanceMode: true })
    await h.chrome.evaluate((url) => window.scb.invoke('tabs:create', url), site.url('/b'))
    await expect(activeTab(h)).toContainText('Page B')
    expect(await tryPlaying('/b')).toBe('NotAllowedError')
  })
})

test.describe('sleeping tabs', () => {
  let h: Harness
  let site: Site
  test.beforeAll(async () => {
    site = await serveSite({ '/a': titled('Page A') })
    h = await launch()
  })
  test.afterAll(async () => {
    await h.close()
    site.server.close()
  })

  test('remember being pinned in their sleep, and wake when reloaded', async () => {
    await go(h, site.url('/a'))
    await expect(activeTab(h)).toContainText('Page A')
    await h.chrome.evaluate(() => window.scb.invoke('tabs:create', 'sc://history'))
    await h.page('sc://history')
    const result = await h.app.evaluate(() => {
      const tabs = (globalThis as unknown as { scbTabs: { snapshot(): { tabs: { id: number; url: string; isSleeping: boolean }[] }; sleepIdle(ms: number, now: number): void; setPinned(id: number, pinned: boolean): void; reload(id: number): void; session(): { tabs: { url: string; pinned?: boolean }[] } } }).scbTabs
      const id = tabs.snapshot().tabs.find((tab) => tab.url.includes('/a'))!.id
      tabs.sleepIdle(0, Date.now() + 1000)
      const slept = tabs.snapshot().tabs.find((tab) => tab.id === id)!.isSleeping
      tabs.setPinned(id, true)
      const pinned = tabs.session().tabs.find((tab) => tab.url.includes('/a'))?.pinned
      tabs.reload(id)
      return { slept, pinned, woke: !tabs.snapshot().tabs.find((tab) => tab.id === id)!.isSleeping }
    })
    expect(result).toEqual({ slept: true, pinned: true, woke: true })
  })
})
