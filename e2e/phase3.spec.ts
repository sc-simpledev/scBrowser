import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTab, go, launch, omnibox, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site

test.beforeEach(async () => {
  site = await serveSite({
    '/alpha': titled('Alpha page', '<div id="ad" class="ad-slot">advert</div><div id="keep">content</div>'),
    '/beta': titled('Beta page')
  })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

const reopenInContainer = (container: string) =>
  h.app.evaluate(
    (_, id) => {
      const { scbTabs } = globalThis as unknown as { scbTabs: { active: { id: number }; reopenInContainer(tab: number, c: string): void } }
      scbTabs.reopenInContainer(scbTabs.active.id, id)
    },
    container
  )

test('containers keep site data apart and survive a restart', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  const plain = await h.page('/alpha')
  await plain.evaluate(() => localStorage.setItem('who', 'default'))

  await reopenInContainer('work')
  await expect(activeTab(h).getByRole('img', { name: 'Work container' })).toBeVisible()
  await expect(activeTab(h)).toContainText('Alpha page')
  const work = await h.page('/alpha')
  expect(await work.evaluate(() => localStorage.getItem('who'))).toBeNull()

  await h.close()
  h = await launch(h.profile)
  await expect(activeTab(h).getByRole('img', { name: 'Work container' })).toBeVisible()
})

test('screenshot saves a PNG and confirms it', async () => {
  await setSetting(h, { downloadDir: h.profile })
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  // Keyboard focus reaches the page a moment after its title appears.
  await expect.poll(() => h.app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL() ?? '')).toContain('/alpha')
  await shortcut(h, 'S', ['control', 'shift'])
  const overlay = await h.overlay()
  await expect(overlay.getByRole('status')).toContainText('Screenshot saved')
  const file = readdirSync(h.profile).find((name) => name.startsWith('Screenshot'))
  expect(file).toBeTruthy()
  expect(readFileSync(join(h.profile, file!)).subarray(1, 4).toString()).toBe('PNG')
})

test('hides ad placeholders with cosmetic filters', async () => {
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).toContainText('Alpha page')
  const page = await h.page('/alpha')
  await expect(page.locator('#ad')).toBeHidden()
  await expect(page.locator('#keep')).toBeVisible()
  await expect(omnibox(h)).toHaveValue(site.url('/alpha'))
})

test('a named profile keeps its own data folder', async () => {
  await h.close()
  h = await launch(undefined, ['--profile=Work'])
  const folder = await h.app.evaluate(({ app }) => app.getPath('userData'))
  expect(folder).toContain(join('profiles', 'Work'))
  expect(await h.chrome.title()).toBeTruthy()
  await go(h, 'sc://settings')
  const page = await h.page('sc://settings')
  await expect(page.getByText('This window')).toBeVisible()
  await expect(page.getByLabel('Profile name')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Profiles' }).getByText('Work')).toBeVisible()
})
