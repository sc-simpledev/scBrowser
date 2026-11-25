import { expect, test } from '@playwright/test'
import { activeTab, go, launch, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

test.beforeEach(async () => {
  const article = '<article><h1>How bread rises</h1>' + '<p>Yeast eats sugar and makes gas, which the gluten traps, so the dough rises and the bread is light.</p>'.repeat(12) + '</article>'
  site = await serveSite({ '/article': titled('How bread rises', article), '/other': titled('Other page') })
  h = await launch()
  await setSetting(h, { httpsOnly: false })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

test('the new tab Customise panel shows each widget by its whole name', async () => {
  await go(h, 'sc://newtab/?customise')
  const page = await h.page('sc://newtab')
  const panel = page.getByRole('complementary', { name: 'Customise new tab' })
  const clock = panel.getByText('Clock', { exact: true })
  await expect(clock).toBeVisible()
  // It was squeezed to a single letter beside two menus and three buttons.
  expect((await clock.boundingBox())!.width).toBeGreaterThan(30)
  await expect(panel.getByRole('combobox', { name: 'Clock width' })).toHaveValue('full')
})

test('the error page says what went wrong in words, with the code underneath', async () => {
  await go(h, 'http://127.0.0.1:9/nothing')
  const page = await h.page('sc://error')
  await expect(page.getByText('This address uses a port that browsers block for safety.')).toBeVisible()
  await expect(page.locator('#code')).toHaveText('ERR_UNSAFE_PORT')
})

test('reader view names the article once, with its site and reading time', async () => {
  await go(h, site.url('/article'))
  await expect(activeTab(h)).toHaveText('How bread rises')
  await shortcut(h, 'F9')
  const reader = await h.page('sc://reader')
  await expect(reader.getByRole('heading', { name: 'How bread rises' })).toHaveCount(1)
  await expect(reader.locator('.byline')).toContainText('127.0.0.1')
  await expect(reader.locator('.byline')).toContainText('min read')
})

test('in a narrow window the full-page assistant folds its chat list', async () => {
  await go(h, 'sc://assistant')
  const page = await h.page('sc://assistant')
  await expect(page.getByRole('heading', { name: 'Set up AI to start chatting' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Saved chats' })).toBeVisible()
  // Made narrow, the list folds away so the conversation keeps the room.
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 700))
  await expect(page.getByRole('navigation', { name: 'Saved chats' })).toHaveCount(0)
})

test('Close other tabs is only offered when there are others', async () => {
  await go(h, site.url('/other'))
  await expect(activeTab(h)).toHaveText('Other page')
  await h.app.evaluate(({ Menu }) => {
    const realm = globalThis as unknown as { lastMenu: unknown }
    Menu.buildFromTemplate = ((template: unknown) => {
      realm.lastMenu = template
      return { popup: () => undefined }
    }) as never
  })
  const closeOthers = async () => {
    const id = await h.app.evaluate(() => (globalThis as unknown as { scbTabs: { active: { id: number } } }).scbTabs.active.id)
    await h.chrome.evaluate((tabId) => window.scb.invoke('tabs:context-menu', tabId), id)
    return h.app.evaluate(() => (globalThis as unknown as { lastMenu: { label?: string; enabled?: boolean }[] }).lastMenu.find((row) => row.label === 'Close other tabs')?.enabled)
  }
  expect(await closeOthers()).toBe(false)
  await shortcut(h, 'T')
  await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  expect(await closeOthers()).toBe(true)
})
