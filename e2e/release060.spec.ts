import { expect, test } from '@playwright/test'
import { activeTab, go, launch, omnibox, serveSite, setSetting, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>
const snapshot = () => main((g) => g.scbTabs.snapshot()) as Promise<{ tabs: { id: number; url: string; title: string }[]; activeId: number; splitIds: number[] }>

test.beforeEach(async () => {
  site = await serveSite({ '/alpha': titled('Alpha page'), '/beta': titled('Beta page') })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

test('a new profile searches with Google', async () => {
  h = await launch()
  await omnibox(h).click()
  await omnibox(h).fill('hello world')
  const overlay = await h.overlay()
  await expect(overlay.getByRole('option', { name: /Search Google/ })).toBeVisible()
})

test('tabs across the top join the toolbar, and only the open one is marked', async () => {
  h = await launch()
  await setSetting(h, { tabLayout: 'horizontal' })
  await go(h, site.url('/alpha'))
  await main((g, url: string) => g.scbTabs.create(url), site.url('/beta'))
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  await expect(h.chrome.locator('[role="tab"][data-active]')).toHaveCount(1)
  await expect(h.chrome.locator('[role="tab"][data-active]')).toContainText('Beta page')
  // The open tab reaches 1 px past the 40 px strip, over the line along the toolbar's top.
  const tab = (await h.chrome.locator('[role="tab"][data-active]').boundingBox())!
  expect(tab.y + tab.height).toBe(41)
})

test('split view shows each page in a card that can swap sides or take the window back', async () => {
  h = await launch()
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  await main((g, url: string) => g.scbTabs.create(url), site.url('/beta'))
  await expect(activeTab(h)).toContainText('Beta page')
  await main((g) => g.scbTabs.toggleSplit())
  const cards = h.chrome.getByRole('region', { name: /^Split view:/ })
  await expect(cards).toHaveCount(2)
  const [beta, alpha] = [h.chrome.getByRole('region', { name: 'Split view: Beta page' }), h.chrome.getByRole('region', { name: 'Split view: Alpha page' })]
  await expect(beta).toHaveAttribute('data-active', 'true')
  // Each page sits inside its card, under the card's bar.
  const fits = await main((g) => {
    const [left, right] = g.scbTabs.snapshot().splitIds.map((id: number) => g.scbTabs.tabs.get(id).view.getBounds())
    const rect = g.scbTabs.page
    return left.x === rect.x + 7 && left.y === rect.y + 6 + 32 && right.x > left.x + left.width && right.x + right.width === rect.x + rect.width - 7
  })
  expect(fits).toBe(true)
  const leftId = (await snapshot()).splitIds[0]
  await beta.getByRole('button', { name: 'Swap sides' }).click()
  await expect.poll(async () => (await snapshot()).splitIds[1]).toBe(leftId)
  // Clicking the other card's bar moves to it.
  await alpha.locator('span', { hasText: 'Alpha page' }).click()
  await expect(alpha).toHaveAttribute('data-active', 'true')
  await alpha.getByRole('button', { name: 'Show only this tab' }).click()
  await expect.poll(async () => (await snapshot()).splitIds.length).toBe(0)
  await expect(activeTab(h)).toContainText('Alpha page')
  await expect(cards).toHaveCount(0)
})

test('after the intro, a new profile is shown what to try, and the list ticks itself off', async () => {
  test.setTimeout(60_000)
  h = await launch(undefined, [], { SCB_WELCOME: '1' })
  const welcome = await h.page('sc://welcome')
  await welcome.getByRole('button', { name: 'Skip intro' }).click()
  await expect(welcome.getByRole('heading', { name: 'Bring your world with you' })).toBeVisible()
  await welcome.getByRole('button', { name: 'Continue' }).click()
  await expect(welcome.getByRole('radio', { name: 'Google' })).toHaveAttribute('aria-checked', 'true')
  await welcome.getByRole('radio', { name: 'DuckDuckGo' }).click()
  await welcome.getByRole('button', { name: 'Continue' }).click()
  await welcome.getByRole('button', { name: 'Continue' }).click()
  await expect(welcome.getByRole('heading', { name: 'A few things to start with' })).toBeVisible()
  // No AI was chosen (this build has no scTerra AI), so the brief can't be turned on.
  await expect(welcome.getByRole('switch', { name: /A morning AI brief/ })).toBeDisabled()
  await expect(welcome.getByRole('switch', { name: /Notes and a calendar/ })).toBeChecked()
  await welcome.getByRole('switch', { name: /Reading list and watched pages/ }).check()
  await welcome.getByRole('button', { name: 'Continue' }).click()
  await welcome.getByRole('button', { name: 'Browse the World' }).click()
  await expect.poll(() => main((g) => g.scbTabs.active?.url ?? ''), { timeout: 10_000 }).toContain('sc://newtab')

  const newTab = await h.page('sc://newtab')
  await expect(newTab.getByRole('region', { name: 'Notes' })).toBeVisible()
  await expect(newTab.getByRole('region', { name: 'Reading list' })).toBeVisible()
  const start = newTab.getByRole('region', { name: 'Get started' })
  await expect(start).toContainText('0 of 5')

  // Trying split view from the list opens it, and ticks it off.
  await start.getByRole('button', { name: /Two tabs side by side/ }).click()
  await expect.poll(async () => (await snapshot()).splitIds.length).toBe(2)
  await expect(start).toContainText('1 of 5')
  await main((g) => g.scbTabs.endSplit())
  // Using the palette anywhere counts too.
  await main((g) => g.scbActions.togglePalette())
  await main((g) => g.scbActions.togglePalette())
  await newTab.reload()
  await expect(newTab.getByRole('region', { name: 'Get started' })).toContainText('2 of 5')
  await newTab.getByRole('region', { name: 'Get started' }).getByRole('button', { name: 'Hide Get started' }).click()
  await expect(newTab.getByRole('region', { name: 'Get started' })).toHaveCount(0)

  // DuckDuckGo was picked during setup.
  await omnibox(h).click()
  await omnibox(h).fill('hello world')
  await expect((await h.overlay()).getByRole('option', { name: /Search DuckDuckGo/ })).toBeVisible()
})
