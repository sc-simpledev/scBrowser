import { expect, test } from '@playwright/test'
import { activeTab, go, launch, serveSite, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>
interface Snap {
  tabs: { id: number; url: string; title: string; group: string | null; depth?: number; parentId?: number | null }[]
  activeId: number
  splitIds: number[]
  splitLinked: boolean
}
const snapshot = () => main((g) => g.scbTabs.snapshot()) as Promise<Snap>
/** Clicks a link in a tab's page as a person would, which is what the browser's own link handling sees. */
const clickLink = (tabId: number, selector: string) =>
  main(
    (g, [id, css]: [number, string]) => {
      const contents = g.scbTabs.contentsFor(id)
      return contents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(css)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`).then(({ x, y }: { x: number; y: number }) => {
        contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
        contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      })
    },
    [tabId, selector] as [number, string]
  )

test.beforeEach(async () => {
  site = await serveSite({
    '/alpha': titled('Alpha page', '<p><a id="same" href="/beta">Beta here</a></p><p><a id="blank" href="/gamma" target="_blank">Gamma in a new tab</a></p>'),
    '/beta': titled('Beta page'),
    '/gamma': titled('Gamma page', '<a id="blank" href="/delta" target="_blank">Delta in a new tab</a>'),
    '/delta': titled('Delta page')
  })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

test('a tab dragged into a group joins it, and one dragged out leaves it', async () => {
  h = await launch()
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  for (const path of ['/beta', '/gamma', '/delta']) await main((g, url: string) => g.scbTabs.create(url, { activate: false }), site.url(path))
  await expect.poll(async () => (await snapshot()).tabs.length).toBe(4)
  const [alpha, beta, gamma, delta] = (await snapshot()).tabs.map((tab) => tab.id) as [number, number, number, number]
  await main((g, ids: number[]) => g.scbTabs.setGroup(ids, 'Work'), [alpha, beta])
  // Delta goes between the two grouped tabs, so it's one of them now.
  await main((g, id: number) => g.scbTabs.move(id, 1), delta)
  let tabs = (await snapshot()).tabs
  expect(tabs.map((tab) => tab.id)).toEqual([alpha, delta, beta, gamma])
  expect(tabs.find((tab) => tab.id === delta)!.group).toBe('Work')
  // And back out to the end, which takes it out of the group. One heading, not two.
  await main((g, id: number) => g.scbTabs.move(id, 3), delta)
  tabs = (await snapshot()).tabs
  expect(tabs.find((tab) => tab.id === delta)!.group).toBeNull()
  await expect(h.chrome.getByRole('button', { name: /^Work group/ })).toHaveCount(1)
})

test('tabs opened from a link sit under the tab they came from', async () => {
  h = await launch()
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  const alpha = (await snapshot()).activeId
  await clickLink(alpha, '#blank')
  await expect(activeTab(h)).toContainText('Gamma page')
  const gamma = (await snapshot()).activeId
  await clickLink(gamma, '#blank')
  await expect(activeTab(h)).toContainText('Delta page')
  const tabs = (await snapshot()).tabs
  expect(tabs.map((tab) => [tab.title, tab.depth])).toEqual([
    ['Alpha page', 0],
    ['Gamma page', 1],
    ['Delta page', 2]
  ])
  await expect(h.chrome.locator('[role="tab"][data-depth="2"]')).toContainText('Delta page')
  // Closing the middle one moves its branch up, rather than dropping it to the top level.
  await main((g, id: number) => g.scbTabs.close(id), gamma)
  await expect.poll(async () => (await snapshot()).tabs.map((tab) => tab.depth)).toEqual([0, 1])
})

test('in a linked split, links on the left open on the right', async () => {
  h = await launch()
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  const alpha = (await snapshot()).activeId
  const delta = await main((g, url: string) => g.scbTabs.create(url, { activate: false }), site.url('/delta'))
  await main((g, id: number) => g.scbTabs.startSplit(id), delta)
  await h.chrome.getByRole('button', { name: 'Open links on the right' }).click()
  await expect.poll(async () => (await snapshot()).splitLinked).toBe(true)
  await clickLink(alpha, '#same')
  await expect.poll(async () => (await snapshot()).tabs.find((tab) => tab.id === delta)!.title).toBe('Beta page')
  const tabs = (await snapshot()).tabs
  expect(tabs.find((tab) => tab.id === alpha)!.title).toBe('Alpha page')
  expect(tabs).toHaveLength(2)
})

test('a snoozed tab closes, waits in Archived tabs, and comes back at its time', async () => {
  h = await launch()
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  const alpha = (await snapshot()).activeId
  await main((g, url: string) => g.scbTabs.create(url), site.url('/beta'))
  await expect(activeTab(h)).toContainText('Beta page')
  await main((g, id: number) => g.scbActions.snoozeTab(id, 'hour'), alpha)
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
  const waiting = await main((g) => g.scbCore.snoozed.list())
  expect(waiting).toHaveLength(1)
  expect(waiting[0].url).toBe(site.url('/alpha'))

  await main((g) => g.scbTabs.openInternal('sc://archive'))
  const page = await h.page('sc://archive')
  await expect(page.getByRole('region', { name: 'Snoozed tabs' })).toContainText('Alpha page')

  // Its time comes.
  await main((g) => {
    const [tab] = g.scbCore.snoozed.list()
    g.scbAi.kv.set('tabs:snoozed', [{ ...tab, wakeAt: Date.now() - 1000 }])
    g.scbCore.snoozed.tick()
  })
  await expect.poll(async () => (await snapshot()).tabs.some((tab) => tab.url === site.url('/alpha'))).toBe(true)
  expect(await main((g) => g.scbCore.snoozed.list())).toHaveLength(0)
})

test('the new tab can show what was blocked this week', async () => {
  h = await launch()
  await main((g) => {
    g.scbCore.privacyStats.noteBlocked('https://tracker.test/a.js')
    g.scbCore.privacyStats.noteBlocked('https://tracker.test/b.js')
    g.scbCore.privacyStats.noteBanner()
  })
  const week = await main((g) => g.scbCore.privacyStats.week())
  expect(week.blocked).toBe(2)
  expect(week.banners).toBe(1)
  expect(week.topHosts[0]).toEqual({ host: 'tracker.test', count: 2 })
})
