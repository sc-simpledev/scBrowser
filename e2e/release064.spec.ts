import { expect, test, type JSHandle } from '@playwright/test'
import { activeTab, go, launch, omnibox, serveSite, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>
interface Snap {
  tabs: { id: number; url: string; title: string; depth?: number; collapsed?: boolean }[]
  activeId: number
  splitIds: number[]
  splitRatio: number
}
const snapshot = () => main((g) => g.scbTabs.snapshot()) as Promise<Snap>
type Row = { label?: string; click?: () => void; submenu?: Row[]; enabled?: boolean }

/** Native menus can't be driven, so keep the last one's rows instead of showing it. */
const captureMenus = () =>
  h.app.evaluate(({ Menu }) => {
    Menu.buildFromTemplate = ((template: unknown) => {
      ;(globalThis as unknown as { lastMenu: unknown }).lastMenu = template
      return { popup: () => undefined }
    }) as never
  })
const menuRows = () => h.app.evaluate(() => JSON.parse(JSON.stringify((globalThis as unknown as { lastMenu: unknown }).lastMenu)) as Row[])
const clickMenuRow = (path: string[]) =>
  h.app.evaluate((_, wanted) => {
    let rows = (globalThis as unknown as { lastMenu: Row[] }).lastMenu
    for (const label of wanted.slice(0, -1)) rows = rows.find((row) => row.label === label)!.submenu!
    rows.find((row) => row.label === wanted.at(-1))!.click!()
  }, path)

test.beforeEach(async () => {
  site = await serveSite({
    '/alpha': titled('Alpha page'),
    '/beta': titled('Beta page'),
    '/gamma': titled('Gamma page'),
    '/a/very/long/path/that/goes/on/and/on/and/does/not/fit/in/the/address/bar/at/all/because/it/keeps/going/well/past/the/end/of/the/box/so/the/bar/has/to/cut/it/short/page.html': titled('Long page')
  })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

test('address bar: matches stand out, history rows can be removed, and @ narrows the list', async () => {
  await go(h, site.url('/alpha'))
  await go(h, site.url('/beta'))
  await h.chrome.evaluate((url) => window.scb.invoke('bookmarks:toggle', url, 'Gamma bookmark'), site.url('/gamma'))
  const overlay = await h.overlay()

  await omnibox(h).click()
  await omnibox(h).pressSequentially('alpha')
  const row = overlay.getByRole('option', { name: /Alpha page/ })
  await expect(row).toBeVisible()
  await expect(row.locator('.font-semibold').first()).toHaveText(/alpha/i)

  // Shift+Delete on the chosen history row removes it from history and the list.
  await omnibox(h).press('ArrowDown')
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(row).toContainText('Shift+Delete to remove')
  await omnibox(h).press('Shift+Delete')
  await expect(row).toHaveCount(0)
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('history:search', 'alpha').then((rows) => rows.length))).toBe(0)

  // @ lists the shortcuts; @bookmarks keeps only bookmarks, and Backspace on an empty box leaves it.
  await omnibox(h).fill('')
  await omnibox(h).pressSequentially('@')
  await expect(overlay.getByRole('option', { name: /@bookmarks/ })).toBeVisible()
  await omnibox(h).pressSequentially('bookmarks ')
  await expect(h.chrome.getByText('Bookmarks', { exact: true })).toBeVisible()
  await expect(omnibox(h)).toHaveValue('')
  await expect(overlay.getByRole('option', { name: /Gamma bookmark/ })).toBeVisible()
  await omnibox(h).pressSequentially('beta')
  await expect(overlay.getByRole('option')).toHaveCount(0)
  for (let i = 0; i < 5; i++) await omnibox(h).press('Backspace')
  await expect(h.chrome.getByText('Bookmarks', { exact: true })).toHaveCount(0)

  // Conversions answer like sums.
  await omnibox(h).fill('')
  await omnibox(h).pressSequentially('5 km in miles')
  await expect(overlay.getByRole('option', { name: /= 3\.10686 mi/ })).toBeVisible()
})

test('address bar: Ctrl+Enter completes a word to .com, and Paste and go opens the clipboard', async () => {
  await go(h, site.url('/alpha'))
  await omnibox(h).click()
  await omnibox(h).pressSequentially('qqqzzexample')
  await omnibox(h).press('Control+Enter')
  const activeUrl = async () => {
    const snap = await snapshot()
    return decodeURIComponent(snap.tabs.find((tab) => tab.id === snap.activeId)!.url)
  }
  await expect.poll(activeUrl).toContain('www.qqqzzexample.com')

  await captureMenus()
  await h.app.evaluate(({ clipboard }, url) => clipboard.writeText(url), site.url('/beta'))
  await h.chrome.evaluate(() => window.scb.invoke('omnibox:context-menu'))
  await expect.poll(async () => (await menuRows()).map((row) => row.label)).toContain('Paste and go')
  await clickMenuRow(['Paste and go'])
  await expect(activeTab(h)).toContainText('Beta page')
})

test('address bar: a cut-off address shows whole on hover', async () => {
  const long = site.url('/a/very/long/path/that/goes/on/and/on/and/does/not/fit/in/the/address/bar/at/all/because/it/keeps/going/well/past/the/end/of/the/box/so/the/bar/has/to/cut/it/short/page.html')
  await go(h, long)
  await expect(activeTab(h)).toContainText('Long page')
  await h.chrome.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await h.chrome.locator('.sc-address').dispatchEvent('pointerover')
  const overlay = await h.overlay()
  await expect(overlay.getByRole('tooltip')).toHaveText(long)
})

test('tabs: Recently closed lists closed tabs to pick from', async () => {
  await go(h, site.url('/alpha'))
  for (const path of ['/beta', '/gamma']) await main((g, url: string) => g.scbTabs.create(url, { activate: false }), site.url(path))
  await expect.poll(async () => (await snapshot()).tabs.length).toBe(3)
  const [, beta, gamma] = (await snapshot()).tabs.map((tab) => tab.id)
  await expect.poll(async () => (await snapshot()).tabs.find((tab) => tab.id === gamma)?.title).toBe('Gamma page')
  await main((g, ids: number[]) => ids.forEach((id) => g.scbTabs.close(id)), [beta!, gamma!])
  await captureMenus()
  await h.chrome.evaluate((id) => window.scb.invoke('tabs:context-menu', id), (await snapshot()).activeId)
  await expect.poll(async () => (await menuRows()).find((row) => row.label === 'Recently closed')?.submenu?.map((row) => row.label)).toEqual(['Gamma page', 'Beta page'])
  await clickMenuRow(['Recently closed', 'Beta page'])
  await expect(activeTab(h)).toContainText('Beta page')
})

test('tabs: hover cards, and a branch of the tree folds away', async () => {
  await go(h, site.url('/alpha'))
  const alpha = (await snapshot()).activeId
  for (const path of ['/beta', '/gamma']) await main((g, [url, parent]: [string, number]) => g.scbTabs.create(url, { activate: false, parentId: parent, afterId: parent }), [site.url(path), alpha] as [string, number])
  await expect.poll(async () => (await snapshot()).tabs.map((tab) => tab.depth)).toEqual([0, 1, 1])

  // A side tab shows its whole title, site and memory beside it.
  await h.chrome.getByRole('tab', { name: 'Alpha page' }).dispatchEvent('pointerover')
  const overlay = await h.overlay()
  const card = overlay.getByRole('tooltip')
  await expect(card).toContainText('Alpha page')
  await expect(card).toContainText(/127\.0\.0\.1:\d+ · \d+ MB memory/)
  await h.chrome.getByRole('tab', { name: 'Alpha page' }).dispatchEvent('pointerout')
  await expect(card).toHaveCount(0)

  await h.chrome.getByRole('button', { name: 'Collapse branch' }).click()
  await expect(h.chrome.getByRole('tab')).toHaveCount(1)
  await expect(h.chrome.getByLabel('2 more in this branch')).toBeVisible()
  expect((await snapshot()).tabs[0]!.collapsed).toBe(true)
  // Picking a folded tab from anywhere unfolds its branch.
  await main((g, id: number) => g.scbTabs.activate(id), (await snapshot()).tabs[2]!.id)
  await expect(h.chrome.getByRole('tab')).toHaveCount(3)
})

test('split view: double-clicking the divider evens it out, and a tab dropped on the page splits', async () => {
  await go(h, site.url('/alpha'))
  const beta = await main((g, url: string) => g.scbTabs.create(url, { activate: false }), site.url('/beta'))
  await expect(h.chrome.getByRole('tab', { name: 'Beta page' })).toBeVisible()

  // Dragging Beta over the page offers its halves; dropping on the left puts it there.
  const data: JSHandle<DataTransfer> = await h.chrome.evaluateHandle(() => new DataTransfer())
  const betaTab = h.chrome.getByRole('tab', { name: 'Beta page' })
  await betaTab.dispatchEvent('dragstart', { dataTransfer: data })
  const drop = h.chrome.getByTestId('split-drop')
  await expect(drop).toBeVisible()
  const box = (await drop.boundingBox())!
  const at = { clientX: box.x + box.width * 0.25, clientY: box.y + box.height / 2 }
  await drop.dispatchEvent('dragover', { dataTransfer: data, ...at })
  await expect(drop).toContainText('on the left')
  await drop.dispatchEvent('drop', { dataTransfer: data, ...at })
  await betaTab.dispatchEvent('dragend', { dataTransfer: data })
  await expect.poll(async () => (await snapshot()).splitIds[0]).toBe(beta)
  await expect(drop).toHaveCount(0)

  await main((g) => g.scbTabs.setSplitRatio(0.3))
  await expect.poll(async () => (await snapshot()).splitRatio).toBeCloseTo(0.3)
  await h.chrome.getByRole('separator', { name: 'Split view divider' }).dblclick()
  await expect.poll(async () => (await snapshot()).splitRatio).toBeCloseTo(0.5)
})
