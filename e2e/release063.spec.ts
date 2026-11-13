import { expect, test } from '@playwright/test'
import { activeTab, go, launch, serveSite, setSetting, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

test.beforeEach(async () => {
  site = await serveSite({ '/alpha': titled('Alpha page'), '/beta': titled('Beta page'), '/long': `<!doctype html><title>Long read</title><main>${'<p>word '.repeat(1500)}</main>` })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>
const tabTitles = () => main((g) => g.scbTabs.snapshot().tabs.map((tab: { title: string }) => tab.title) as string[])

test('the sidebar timer is off until turned on, then starts, stops and folds into a ring', async () => {
  await setSetting(h, { tabLayout: 'vertical' })
  const card = h.chrome.getByRole('region', { name: 'Focus timer' })
  await expect(card).toHaveCount(0)
  await setSetting(h, { sidebarTimer: true })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /^Focus timer: .*Start Focus$/ }).click()
  await expect(card.getByRole('button', { name: /^Focus timer: Focus, .*Stop$/ })).toBeVisible()
  // The toolbar chip would only repeat it.
  await expect(h.chrome.getByRole('button', { name: /^Focus timer: Focus, .* today\. Open the timer$/ })).toHaveCount(0)
  await setSetting(h, { verticalTabsCollapsed: true })
  await expect(h.chrome.getByRole('button', { name: /^Focus timer: Focus, .*Stop$/ })).toBeVisible()
  await h.chrome.getByRole('button', { name: /^Focus timer: Focus, .*Stop$/ }).click()
  await expect.poll(() => main((g) => g.scbCore.study.running())).toBeNull()
})

test('a tab snoozed until its site comes back when the site is opened, and split pairs return together', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  await main((g) => g.scbTabs.create('about:blank'))
  await main((g) => g.scbActions.snoozeTab(g.scbTabs.snapshot().tabs.find((tab: { title: string }) => tab.title === 'Alpha page').id, 'site'))
  await expect.poll(tabTitles).not.toContain('Alpha page')
  await go(h, site.url('/beta'))
  await expect.poll(tabTitles).toContain('Alpha page')

  // Split the two pages, leave for another tab, and come back to one of them.
  const ids = await main((g) => g.scbTabs.snapshot().tabs.filter((tab: { title: string }) => /Alpha|Beta/.test(tab.title)).map((tab: { id: number }) => tab.id) as number[])
  await main((g, [left, right]: number[]) => {
    g.scbTabs.activate(left)
    g.scbTabs.startSplit(right)
  }, ids)
  await expect.poll(() => main((g) => g.scbTabs.snapshot().splitIds.length)).toBe(2)
  const other = await main((g) => g.scbTabs.create('about:blank'))
  await main((g, id: number) => g.scbTabs.activate(id), other)
  await expect.poll(() => main((g) => g.scbTabs.snapshot().splitIds.length)).toBe(0)
  await main((g, id: number) => g.scbTabs.activate(id), ids[1]!)
  await expect.poll(() => main((g) => g.scbTabs.snapshot().splitIds)).toEqual(ids)
})

test('the reading list says how long a page takes, and picks one that fits the time', async () => {
  await go(h, site.url('/long'))
  await expect(activeTab(h)).toContainText('Long read')
  await main((g) => g.scbActions.addToReadingList())
  await expect.poll(() => main((g) => g.scbCore.readingList.list()[0]?.minutes)).toBe(7)
  await go(h, 'sc://reading')
  const page = await h.page('sc://reading')
  await expect(page.getByText('7 min read')).toBeVisible()
  await page.getByRole('combobox', { name: 'Minutes to read' }).selectOption('10')
  await page.getByRole('button', { name: 'Read something in' }).click()
  await expect(activeTab(h)).toContainText('Long read')
})

test('a blocked site lets you through for a minute after a short wait', async () => {
  await setSetting(h, { blocker: { enabled: true, rules: [{ id: 'r', domain: '127.0.0.1', when: 'always', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }], messages: [], categories: [], categoryMode: 'off', allowlist: [] } })
  await go(h, site.url('/alpha'))
  const blocked = await h.page('sc://blocked')
  await blocked.getByRole('button', { name: 'One more minute' }).click()
  await expect(blocked.getByRole('button', { name: /Wait \d s/ })).toBeDisabled()
  await blocked.getByRole('button', { name: 'Open for one minute' }).click({ timeout: 8000 })
  await expect(activeTab(h)).toContainText('Alpha page')
})
