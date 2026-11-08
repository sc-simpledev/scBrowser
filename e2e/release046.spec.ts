import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTab, go, launch, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
test.beforeAll(async () => {
  site = await serveSite({ '/a': titled('Page A'), '/b': titled('Page B'), '/download': titled('Download', '<a id="dl" href="/file.txt">Get it</a>') })
})
test.afterAll(() => site.server.close())
test.beforeEach(async () => {
  h = await launch()
  await setSetting(h, { httpsOnly: false })
})
test.afterEach(() => h.close())

const settingsNow = () => h.chrome.evaluate(() => window.scb.invoke('settings:get'))

async function palette(command: string) {
  await shortcut(h, 'k')
  const overlay = await h.overlay()
  const input = overlay.getByRole('combobox', { name: 'Type a command' })
  await input.fill(command)
  return { overlay, input }
}

test('the command palette changes settings, but only lists them once something is typed', async () => {
  const { overlay, input } = await palette('')
  await expect(overlay.getByRole('option').first()).toBeVisible()
  await expect(overlay.getByRole('option', { name: /Setting$/ })).toHaveCount(0)
  await input.fill('theme dark')
  await expect(overlay.getByRole('option', { name: /Theme: dark/ })).toBeVisible()
  await input.press('Enter')
  await expect.poll(async () => (await settingsNow()).theme).toBe('dark')
  await expect(overlay.getByRole('status')).toContainText('Theme: dark')
})

test('a focus session turns Focus Mode on with a countdown, and the countdown ends it', async () => {
  const { input } = await palette('focus for 25')
  await input.press('Enter')
  await expect.poll(async () => (await settingsNow()).focusMode).toBe(true)
  const { focusUntil } = await settingsNow()
  expect(focusUntil - Date.now()).toBeGreaterThan(24 * 60_000)
  const chip = h.chrome.getByRole('button', { name: /^Focus Mode, 25 min left/ })
  await expect(chip).toBeVisible()
  await chip.click()
  await expect.poll(async () => (await settingsNow()).focusMode).toBe(false)
  await expect(chip).toHaveCount(0)
  // Ending by hand clears the timer too, so it can't turn anything off later.
  expect((await settingsNow()).focusUntil).toBe(0)
})

test('the padlock opens the site controls, which change things for that site at once', async () => {
  await go(h, site.url('/a'))
  await expect(activeTab(h)).toContainText('Page A')
  await h.chrome.getByRole('button', { name: 'Site controls' }).click()
  const overlay = await h.overlay()
  const panel = overlay.getByRole('dialog', { name: 'Controls for 127.0.0.1' })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Not secure')

  await panel.getByRole('switch', { name: 'Allow AI on this site' }).click()
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('ai:status').then((s) => s.disabledHosts))).toContain(new URL(site.url('/')).host)
  await expect(panel.getByRole('switch', { name: 'Allow AI on this site' })).toHaveAttribute('aria-checked', 'false')

  await panel.getByRole('button', { name: 'Zoom in' }).click()
  await expect(panel.getByRole('button', { name: 'Reset zoom' })).toHaveText('110%')
  await panel.getByRole('button', { name: 'Reset zoom' }).click()
  await expect(panel.getByRole('button', { name: 'Reset zoom' })).toHaveText('100%')

  await panel.getByRole('switch', { name: 'Forget this site when scTerra closes' }).click()
  await expect.poll(async () => (await settingsNow()).forgetOnClose).toEqual(['127.0.0.1'])

  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toHaveCount(0)
})

test('tab search finds tabs in other windows, and goes to them', async () => {
  await go(h, site.url('/a'))
  // A second window, holding a page to find by name.
  await h.app.evaluate((_electron, url) => (globalThis as any).scbCore.openWindow({ urls: [url] }), site.url('/b'))
  await expect.poll(() => h.app.evaluate(() => (globalThis as any).scbCore.windows.length)).toBe(2)
  await expect.poll(() => h.app.evaluate(() => (globalThis as any).scbCore.windows[1].tabs.searchRows().some((row: { title: string }) => row.title === 'Page B'))).toBe(true)
  await h.app.evaluate(() => (globalThis as any).scbCore.windows[0].actions.searchTabs())
  const overlay = await h.overlay()
  const row = overlay.getByRole('option', { name: /Page B/ })
  await expect(row).toContainText('Window 2')
  await row.click()
  await expect.poll(() => h.app.evaluate(({ BaseWindow }) => BaseWindow.getFocusedWindow() === (globalThis as any).scbCore.windows[1].window)).toBe(true)
})

test('settings list what changed, reset one at a time, and go to and from a file', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'scb-settings-'))
  const file = join(folder, 'settings.json')
  try {
    await setSetting(h, { theme: 'dark', accentTint: true })
    await go(h, 'sc://settings')
    const page = await h.page('sc://settings')
    await page.getByRole('button', { name: 'Changed', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Theme' })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Accent tint' })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Memory saver' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Reset Accent tint to default' }).click()
    await expect(page.getByRole('switch', { name: 'Accent tint' })).toHaveCount(0)
    expect((await settingsNow()).accentTint).toBe(false)

    await h.app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, file)
    await page.getByRole('button', { name: 'Changed', exact: true }).click()
    await page.evaluate(() => {
      location.hash = 'about'
    })
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect.poll(() => existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).settings.theme).toBe('dark')

    writeFileSync(file, JSON.stringify({ kind: 'scterra-settings', version: 1, settings: { theme: 'light', searchEngine: 'nope' } }))
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect.poll(async () => (await settingsNow()).theme).toBe('light')
    expect((await settingsNow()).searchEngine).toBe('duckduckgo')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('download rules send files to their own folder, and finished files can be renamed', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'scb-rule-'))
  try {
    await setSetting(h, { downloadDir: h.profile, downloadRules: [{ kind: 'type', match: 'txt', folder }] })
    await go(h, site.url('/download'))
    const tab = await h.page('/download')
    await tab.locator('#dl').click()
    await expect.poll(() => existsSync(join(folder, 'file.txt'))).toBe(true)
    expect(existsSync(join(h.profile, 'file.txt'))).toBe(false)

    await go(h, 'sc://downloads')
    const page = await h.page('sc://downloads')
    await page.getByRole('button', { name: 'Rename' }).click()
    const name = page.getByRole('textbox', { name: 'New name for file.txt' })
    await name.fill('Kept notes')
    await name.press('Enter')
    await expect(page.getByText('Kept notes.txt')).toBeVisible()
    expect(existsSync(join(folder, 'Kept notes.txt'))).toBe(true)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('new tab widgets show recent downloads, the reading list and watched pages', async () => {
  await h.app.evaluate((_electron, url) => (globalThis as any).scbCore.readingList.add(url, 'Saved for later'), site.url('/b'))
  await setSetting(h, {
    newTab: { widgets: [{ id: 'downloads', size: 'half' }, { id: 'reading', size: 'half' }, { id: 'watching', size: 'full' }] }
  })
  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  const page = await h.page('sc://newtab')
  await expect(page.getByRole('region', { name: 'Recent downloads' })).toContainText('Nothing downloaded yet')
  await expect(page.getByRole('region', { name: /Reading list · 1 unread/ })).toContainText('Saved for later')
  await expect(page.getByRole('region', { name: 'Watched pages' })).toContainText('Not watching any pages')
})

test('highlights export as Markdown, and the reading digest goes to the assistant', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'scb-md-'))
  const file = join(folder, 'Highlights.md')
  try {
    await h.app.evaluate((_electron, url) => {
      const core = (globalThis as any).scbCore
      core.highlights.add(url, 'Page A', 'An important line')
      core.readingList.add(url, 'Unread page')
    }, site.url('/a'))
    await h.app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
    }, file)
    await go(h, 'sc://highlights')
    const highlights = await h.page('sc://highlights')
    await highlights.getByRole('button', { name: 'Export' }).click()
    await expect.poll(() => existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('> An important line')

    await go(h, 'sc://reading')
    const reading = await h.page('sc://reading')
    await reading.getByRole('button', { name: 'Digest of unread' }).click()
    await expect(activeTab(h)).toContainText('Assistant')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('a container set to go direct skips the VPN', async () => {
  // What each session is told, rather than Chromium's own lookup, which tests' --no-proxy-server can override.
  const told = () =>
    h.app.evaluate(async ({ session }) => {
      const core = (globalThis as any).scbCore
      core.proxyRules = 'socks5://127.0.0.1:9'
      const banking = session.fromPartition('persist:container-banking')
      const work = session.fromPartition('persist:container-work')
      const modes: string[] = []
      for (const target of [banking, work]) {
        const real = target.setProxy.bind(target)
        target.setProxy = ((config: { mode?: string; proxyRules?: string }) => {
          modes.push(config.mode === 'direct' ? 'direct' : (config.proxyRules ?? ''))
          return real(config as never)
        }) as typeof target.setProxy
        await core.applySessionProxy(target)
        target.setProxy = real
      }
      return modes
    })
  expect(await told()).toEqual(['socks5://127.0.0.1:9', 'socks5://127.0.0.1:9'])
  await setSetting(h, { vpnDirectContainers: ['banking'] })
  expect(await told()).toEqual(['direct', 'socks5://127.0.0.1:9'])
})
