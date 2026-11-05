import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { startAiMock } from './aiMock'
import { activeTab, go, launch, newProfile, omnibox, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let other: Site

const MASTER = 'a long master password'
const LOGIN = `<!doctype html><title>Sign in</title><form onsubmit="event.preventDefault(); document.title = 'Signed in as ' + document.getElementById('u').value">
  <input id="u" name="username"><input id="p" name="password" type="password"><button>Sign in</button></form>`
const FORM = `<!doctype html><title>Checkout</title><form>
  <label>Full name <input id="name" name="name"></label>
  <input id="email" autocomplete="email">
  <input id="phone" name="phone">
  <input id="street" name="street_address">
  <input id="town" aria-label="City">
  <select id="country" name="country"><option value="">Choose</option><option value="AU">Australia</option></select>
  <input id="kept" name="company" value="Already here">
  <input id="card" name="card_number">
  <input id="user" name="username">
  <input id="pass" type="password" name="address">
</form>`

test.beforeEach(async () => {
  other = await serveSite({ '/elsewhere': titled('Elsewhere') })
  site = await serveSite({
    '/alpha': titled('Alpha page'),
    '/beta': titled('Beta page'),
    '/gamma': titled('Gamma page'),
    '/login': LOGIN,
    '/login2': LOGIN,
    '/login3': LOGIN,
    '/form': FORM,
    '/hello': `<!doctype html><title>Hello</title><h1>Good morning</h1>`,
    '/links': titled('Links', `<a id="app" href="zzscb://open/1">app</a>
      <a id="blocked" href="ms-msdt:x">blocked</a>
      <a id="blank" target="_blank" href="zzscb://open/2">blank</a>
      <a id="out" target="_blank" href="${other.url('/elsewhere')}">out</a>`)
  })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
  other.server.close()
})

/** Runs in the main process, with the app's test hooks to hand. */
const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>
const snapshot = () => main((g) => g.scbTabs.snapshot()) as Promise<{ tabs: { id: number; url: string; pinned: boolean; muted: boolean; title: string }[]; activeId: number; splitIds: number[]; splitRatio: number; devToolsWidth: number }>
const titles = async () => (await snapshot()).tabs.map((tab) => tab.title)

async function open(path: string, title: string) {
  await main((g, url: string) => g.scbTabs.create(url), site.url(path))
  await expect(activeTab(h)).toContainText(title)
}

const restart = async () => {
  const { profile } = h
  await main((g) => g.scbCore.saver.flush())
  await h.close()
  h = await launch(profile)
}

/** Native menus can't be clicked from a test, so this keeps the rows the app builds. */
const captureMenu = () =>
  h.app.evaluate(({ Menu }) => {
    const realm = globalThis as unknown as { lastMenu: unknown }
    Menu.buildFromTemplate = ((template: unknown) => {
      realm.lastMenu = template
      return { popup: () => undefined, append: () => undefined }
    }) as never
  })
const menuLabels = () => main((g) => g.lastMenu.flatMap((row: { label?: string }) => (row.label ? [row.label] : []))) as Promise<string[]>
const clickRow = (label: string) => main((g, wanted: string) => g.lastMenu.find((row: { label?: string }) => row.label === wanted).click(), label)
/** What Chromium reports for a right-click, on the open tab. */
const rightClick = (params: Record<string, unknown>) =>
  main(
    (g, extra: Record<string, unknown>) => {
      const contents = g.scbTabs.contentsFor(g.scbTabs.active.id)
      const base = { x: 1, y: 1, linkURL: '', linkText: '', pageURL: contents.getURL(), frameURL: '', srcURL: '', mediaType: 'none', hasImageContents: false, isEditable: false, selectionText: '', titleText: '', altText: '', suggestedFilename: '', misspelledWord: '', dictionarySuggestions: [], frameCharset: '', formControlType: 'none', spellcheckEnabled: true, menuSourceType: 'mouse', mediaFlags: {}, editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false } }
      contents.emit('context-menu', {}, { ...base, ...extra })
    },
    params
  )

async function stubApps(name = 'Test App') {
  await h.app.evaluate(({ app, shell }, appName) => {
    const realm = globalThis as unknown as { opened: string[] }
    realm.opened = []
    app.getApplicationNameForProtocol = () => appName
    shell.openExternal = (async (url: string) => void realm.opened.push(url)) as never
  }, name)
}
const opened = () => main((g) => g.opened) as Promise<string[]>

async function createVault() {
  await go(h, 'sc://passwords')
  const page = await h.page('sc://passwords')
  await page.getByRole('textbox', { name: 'Master password', exact: true }).fill(MASTER)
  await page.getByRole('textbox', { name: 'Repeat master password' }).fill(MASTER)
  await page.getByRole('button', { name: 'Create vault' }).click()
  await expect(page.getByRole('region', { name: 'Logins' })).toBeVisible({ timeout: 15_000 })
  return page
}

async function signIn(tabPath = '/login') {
  await main((g, url: string) => g.scbTabs.create(url), site.url(tabPath))
  const login = await h.page(tabPath)
  await expect(login).toHaveTitle('Sign in')
  await login.locator('#u').fill('sam')
  await login.locator('#p').fill('secret')
  await login.getByRole('button', { name: 'Sign in' }).click()
  await expect(login).toHaveTitle('Signed in as sam')
}

const chromeWindows = () => h.app.windows().filter((page) => page.url().includes('/renderer/index.html'))
const waitForWindows = (count: number) => expect.poll(() => main((g) => g.scbCore.windows.length)).toBe(count)

test.describe('tabs', () => {
  test('pinned tabs stay first, survive closing others, and come back after a restart', async () => {
    await setSetting(h, { startup: 'restore' })
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await open('/beta', 'Beta page')
    await open('/gamma', 'Gamma page')
    const gamma = (await snapshot()).activeId
    await main((g, id: number) => g.scbTabs.setPinned(id, true), gamma)
    await expect.poll(titles).toEqual(['Gamma page', 'Alpha page', 'Beta page'])
    // A pinned tab is only an icon, with no close button.
    await expect(h.chrome.locator(`[data-tab-id="${gamma}"]`).getByRole('button', { name: 'Close tab' })).toHaveCount(0)
    // Dragging can't put another tab ahead of it.
    const beta = (await snapshot()).tabs[2]!.id
    await main((g, id: number) => g.scbTabs.move(id, 0), beta)
    await expect.poll(async () => (await titles())[0]).toBe('Gamma page')

    await restart()
    await expect.poll(titles).toEqual(['Gamma page', 'Beta page', 'Alpha page'])
    expect((await snapshot()).tabs[0]!.pinned).toBe(true)

    await main((g) => g.scbTabs.activate(g.scbTabs.snapshot().tabs[1].id))
    await main((g) => g.scbTabs.closeOthers(g.scbTabs.active.id))
    await expect.poll(titles).toEqual(['Gamma page', 'Beta page'])
  })

  test('pinned tabs are left out of grouping and clean-up', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await open('/beta', 'Beta page')
    const [alpha, beta] = (await snapshot()).tabs.map((tab) => tab.id)
    await main((g, id: number) => g.scbTabs.setPinned(id, true), alpha!)
    await main((g, ids: number[]) => g.scbTabs.applyGroups([{ name: 'Letters', ids }]), [alpha!, beta!])
    const after = (await main((g) => g.scbTabs.snapshot())) as { tabs: { id: number; group: string | null }[] }
    expect(after.tabs.find((tab) => tab.id === alpha)!.group).toBeNull()
    expect(after.tabs.find((tab) => tab.id === beta)!.group).toBe('Letters')
    const offered = (await main((g) => g.scbTabs.cleanupInput())) as { id: number }[]
    expect(offered.map((tab) => tab.id)).not.toContain(alpha)
  })

  test('side tabs close from a button on the right, and the narrow rail from the favicon', async () => {
    await setSetting(h, { tabLayout: 'vertical', verticalTabsCollapsed: false })
    await go(h, site.url('/alpha'))
    const tab = activeTab(h)
    await expect(tab).toContainText('Alpha page')
    const box = (await tab.boundingBox())!
    const close = (await tab.getByRole('button', { name: 'Close tab' }).boundingBox())!
    expect(close.x).toBeGreaterThan(box.x + box.width / 2)
    await setSetting(h, { verticalTabsCollapsed: true })
    await expect(h.chrome.getByRole('button', { name: 'Expand tabs' })).toBeVisible()
    const rail = (await activeTab(h).boundingBox())!
    const onIcon = (await activeTab(h).getByRole('button', { name: 'Close tab' }).boundingBox())!
    expect(onIcon.x).toBeLessThan(rail.x + rail.width / 2 + 4)
  })

  test('a tab with sound shows it, and the button mutes it', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const mute = activeTab(h).getByRole('button', { name: 'Mute tab' })
    await expect(mute).toHaveCount(0)
    await main((g) => g.scbTabs.contentsFor(g.scbTabs.active.id).emit('audio-state-changed', { audible: true }))
    await mute.click()
    await expect(activeTab(h).getByRole('button', { name: 'Unmute tab' })).toBeVisible()
    expect(await main((g) => g.scbTabs.contentsFor(g.scbTabs.active.id).isAudioMuted())).toBe(true)
    await activeTab(h).getByRole('button', { name: 'Unmute tab' }).click()
    await expect(mute).toBeVisible()
    expect(await main((g) => g.scbTabs.contentsFor(g.scbTabs.active.id).isAudioMuted())).toBe(false)
  })

  test('a muted tab stays muted after a restart', async () => {
    await setSetting(h, { startup: 'restore' })
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await main((g) => g.scbTabs.setMuted(g.scbTabs.active.id, true))
    await restart()
    await expect(activeTab(h)).toContainText('Alpha page')
    await expect.poll(() => main((g) => g.scbTabs.contentsFor(g.scbTabs.active.id)?.isAudioMuted())).toBe(true)
  })

  test('tab search finds a tab in any workspace, and closes one from the list', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await open('/beta', 'Beta page')
    const overlay = await h.overlay()
    await shortcut(h, 'E', ['control', 'shift'])
    const dialog = overlay.getByRole('dialog', { name: 'Search tabs' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('option')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Close Beta page' }).click()
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await expect.poll(titles).toEqual(['Alpha page'])

    await main((g) => g.scbTabs.setWorkspaces([...g.scbTabs.workspaceList(), { id: 'w2', name: 'Other place', focus: false }]))
    await main((g) => g.scbTabs.switchWorkspace('w2'))
    await main((g, url: string) => g.scbTabs.create(url), site.url('/gamma'))
    await expect(activeTab(h)).toContainText('Gamma page')
    await main((g) => g.scbActions.searchTabs())
    await main((g) => g.scbActions.searchTabs())
    // The new workspace opened with its own new tab, beside the one just added.
    await expect(dialog.getByRole('option')).toHaveCount(3)
    await expect(dialog.getByRole('option', { name: /Alpha page/ })).toContainText('Personal')
    await dialog.getByRole('combobox').fill('alpha')
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await dialog.getByRole('combobox').press('Enter')
    await expect(activeTab(h)).toContainText('Alpha page')
    await expect(dialog).toHaveCount(0)
  })

  test('split view has a button and a divider that moves the pages and is remembered', async () => {
    await setSetting(h, { startup: 'restore' })
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await open('/beta', 'Beta page')
    await h.chrome.getByRole('button', { name: 'Split view', exact: true }).click()
    await expect(h.chrome.getByRole('button', { name: 'End split view' })).toBeVisible()
    const divider = h.chrome.getByRole('separator', { name: 'Split view divider' })
    const box = (await divider.boundingBox())!
    await h.chrome.mouse.move(box.x + box.width / 2, box.y + 100)
    await h.chrome.mouse.down()
    await h.chrome.mouse.move(box.x - 150, box.y + 100, { steps: 4 })
    await h.chrome.mouse.up()
    await expect.poll(async () => (await snapshot()).splitRatio).toBeLessThan(0.45)
    const widths = () => main((g) => g.scbTabs.snapshot().splitIds.map((id: number) => g.scbTabs.tabs.get(id).view.getBounds().width)) as Promise<number[]>
    await expect.poll(async () => { const [left, right] = await widths(); return left! < right! }).toBe(true)
    const ratio = (await snapshot()).splitRatio
    await restart()
    await expect.poll(async () => (await snapshot()).splitRatio).toBeCloseTo(ratio, 3)
    await expect.poll(async () => (await snapshot()).splitIds.length).toBe(2)
  })
})

test.describe('addresses and menus', () => {
  test('a typed script runs on the page, but never on the browser\'s own pages', async () => {
    await go(h, site.url('/alpha'))
    const page = await h.page('/alpha')
    await expect(page).toHaveTitle('Alpha page')
    await go(h, 'javascript:document.title="ran%20it"')
    await expect(page).toHaveTitle('ran it')
    await go(h, 'sc://settings')
    const settings = await h.page('sc://settings')
    await expect(activeTab(h)).toContainText('Settings')
    await go(h, 'javascript:document.title="hacked"')
    const overlay = await h.overlay()
    await expect(overlay.getByRole('status')).toContainText("Scripts can't run")
    expect(await settings.title()).not.toBe('hacked')
  })

  test('only the browser controls can run a script', async () => {
    await go(h, site.url('/alpha'))
    const page = await h.page('/alpha')
    await expect(page).toHaveTitle('Alpha page')
    await main((g) => g.scbTabs.navigate(g.scbTabs.active.id, 'javascript:document.title="hacked"'))
    await main((g) => g.scbTabs.create('javascript:document.title="hacked"', { activate: false }))
    await page.waitForTimeout(300)
    expect(await page.title()).toBe('Alpha page')
    expect((await snapshot()).tabs.at(-1)!.url).toContain('sc://newtab')
  })

  test('pasting a script into the address bar loses its prefix', async () => {
    await omnibox(h).click()
    await omnibox(h).evaluate((input) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text', 'javascript:alert(1)')
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
    })
    await expect(omnibox(h)).toHaveValue('alert(1)')
  })

  test('a bookmarklet runs on the open page', async () => {
    await setSetting(h, { bookmarksBar: 'always' })
    await go(h, site.url('/alpha'))
    const page = await h.page('/alpha')
    await expect(page).toHaveTitle('Alpha page')
    await h.chrome.evaluate(() => window.scb.invoke('bookmarks:toggle', 'javascript:document.title="marked"', 'Marklet'))
    await h.chrome.getByTitle('javascript:document.title="marked"').click()
    await expect(page).toHaveTitle('marked')
  })

  test('a link to another app asks first, and can be always allowed', async () => {
    await stubApps()
    await go(h, site.url('/links'))
    const page = await h.page('/links')
    await expect(page).toHaveTitle('Links')
    const overlay = await h.overlay()
    const prompt = overlay.getByRole('alertdialog', { name: 'Open in another app' })

    await page.locator('#app').click()
    await expect(prompt).toContainText('wants to open Test App')
    await prompt.getByRole('button', { name: 'Cancel' }).click()
    await expect(prompt).toHaveCount(0)
    expect(await opened()).toEqual([])

    await page.locator('#blank').click()
    await expect(prompt).toContainText('zzscb://open/2')
    await expect(prompt.getByRole('button', { name: 'Open' })).toBeEnabled()
    await prompt.getByRole('button', { name: 'Open' }).click()
    await expect.poll(opened).toEqual(['zzscb://open/2'])

    await page.locator('#app').click()
    await prompt.getByRole('checkbox').check()
    await expect(prompt.getByRole('button', { name: 'Open' })).toBeEnabled()
    await prompt.getByRole('button', { name: 'Open' }).click()
    await expect.poll(async () => (await opened()).length).toBe(2)
    await page.locator('#app').click()
    await expect.poll(async () => (await opened()).length).toBe(3)
    await expect(prompt).toHaveCount(0)

    await go(h, 'sc://settings')
    const settings = await h.page('sc://settings')
    await expect(settings.getByText('Allowed to open zzscb: links')).toBeVisible()
  })

  test('dangerous links never ask, and background tabs can\'t ask', async () => {
    await stubApps()
    await go(h, site.url('/links'))
    const page = await h.page('/links')
    await expect(page).toHaveTitle('Links')
    const overlay = await h.overlay()
    await page.locator('#blocked').click()
    await overlay.waitForTimeout(400)
    await expect(overlay.getByRole('alertdialog', { name: 'Open in another app' })).toHaveCount(0)

    await open('/beta', 'Beta page')
    await main((g) => {
      const { tabs, activeId } = g.scbTabs.snapshot()
      const background = tabs.find((tab: { id: number }) => tab.id !== activeId)
      g.scbActions.openAppLink('zzscb://x', 'http://a.example/', g.scbTabs.contentsFor(background.id))
    })
    await overlay.waitForTimeout(300)
    await expect(overlay.getByRole('alertdialog', { name: 'Open in another app' })).toHaveCount(0)
  })

  test('a typed app link asks, the question leaves with the tab, and a missing app says so', async () => {
    await stubApps()
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const overlay = await h.overlay()
    const prompt = overlay.getByRole('alertdialog', { name: 'Open in another app' })
    await go(h, 'zzscb://typed')
    await expect(prompt).toContainText('Open Test App?')
    await expect(prompt.getByRole('checkbox')).toHaveCount(0)
    await prompt.getByRole('button', { name: 'Cancel' }).click()

    await open('/beta', 'Beta page')
    await main((g) => g.scbActions.openAppLink('zzscb://x', 'http://a.example/', g.scbTabs.contentsFor(g.scbTabs.active.id)))
    await expect(prompt).toBeVisible()
    await main((g) => g.scbTabs.activateRelative(1))
    await expect(prompt).toHaveCount(0)

    await stubApps('')
    await go(h, 'zzscb://typed')
    await expect(overlay.getByRole('status')).toContainText('No app here opens zzscb: links')
  })

  test('the page menu offers what fits what was clicked', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await captureMenu()
    await rightClick({})
    expect(await menuLabels()).toEqual(expect.arrayContaining(['Back', 'Save page as…', 'Screenshot', 'Bookmark this page', 'Copy page address', 'Reader view', 'Translate page', 'View page source', 'Inspect']))

    await rightClick({ linkURL: site.url('/beta'), linkText: 'Beta' })
    expect(await menuLabels()).toEqual(expect.arrayContaining(['Open link in new tab', 'Open link in new window', 'Open link in split view', 'Copy link address', 'Copy link text']))

    await rightClick({ linkURL: 'mailto:a@b.example' })
    expect(await menuLabels()).toEqual(expect.arrayContaining(['Open link in app', 'Copy link address']))

    await rightClick({ mediaType: 'image', srcURL: site.url('/a.png') })
    expect(await menuLabels()).toEqual(expect.arrayContaining(['Open image in new tab', 'Copy image address']))

    await rightClick({ mediaType: 'video', srcURL: 'blob:http://a/b' })
    const video = await menuLabels()
    expect(video).toContain('Picture in picture')
    expect(video).not.toContain('Save video as…')

    await rightClick({ selectionText: 'R&D notes' })
    expect((await menuLabels()).join()).toContain('Search for “R&&D notes”')
    await main((g) => g.lastMenu.find((row: { label?: string }) => row.label?.startsWith('Search for')).click())
    await expect(activeTab(h)).toBeVisible()
    await expect.poll(async () => (await snapshot()).tabs.at(-1)!.url).toContain('R%26D')
  })

  test('a link opened in a new tab stays in the background, for the page and for extensions', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await captureMenu()
    await rightClick({ linkURL: site.url('/beta'), linkText: 'Beta' })
    await clickRow('Open link in new tab')
    await expect.poll(titles).toEqual(['Alpha page', 'Beta page'])
    await expect(activeTab(h)).toContainText('Alpha page')
    await h.chrome.waitForTimeout(200)
    await expect(activeTab(h)).toContainText('Alpha page')
  })

  test('opening a link in split view shows both', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await captureMenu()
    await rightClick({ linkURL: site.url('/beta'), linkText: 'Beta' })
    await clickRow('Open link in split view')
    await expect.poll(async () => (await snapshot()).splitIds.length).toBe(2)
  })

  test('page source opens in its own tab, from the shortcut', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await shortcut(h, 'U')
    await expect.poll(async () => (await snapshot()).tabs.at(-1)!.url).toBe(`view-source:${site.url('/alpha')}`)
    // Playwright doesn't list source views as pages, so this asks the tab itself.
    await expect.poll(() => main((g) => g.scbTabs.contentsFor(g.scbTabs.active.id).executeJavaScript('document.body.innerText'))).toContain('<title>Alpha page</title>')
    // Nothing for it on the browser's own pages.
    await go(h, 'sc://settings')
    await expect(activeTab(h)).toContainText('Settings')
    await shortcut(h, 'U')
    await h.chrome.waitForTimeout(300)
    await expect.poll(async () => (await snapshot()).tabs.length).toBe(2)
  })

  test('spelling suggestions, the dictionary and the switch', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await captureMenu()
    await rightClick({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'tech'] })
    expect(await menuLabels()).toEqual(expect.arrayContaining(['the', 'tech', 'Add to dictionary', 'Check spelling', 'Paste as plain text']))
    await rightClick({ isEditable: true, misspelledWord: 'qwxz', dictionarySuggestions: [] })
    expect(await menuLabels()).toContain('No suggestions')
    await clickRow('Add to dictionary')
    await expect.poll(() => h.app.evaluate(({ session }) => session.defaultSession.listWordsInSpellCheckerDictionary())).toContain('qwxz')

    await rightClick({ isEditable: true, formControlType: 'input-password' })
    expect(await menuLabels()).not.toContain('Check spelling')

    await rightClick({ isEditable: true })
    await clickRow('Check spelling')
    await expect.poll(() => h.app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled())).toBe(false)
    await setSetting(h, { spellCheck: true, spellLanguage: 'fr' })
    await expect.poll(() => h.app.evaluate(({ session }) => session.defaultSession.getSpellCheckerLanguages()[0])).toMatch(/^fr/)
    await go(h, 'sc://settings')
    const settings = await h.page('sc://settings')
    await expect(settings.getByRole('switch', { name: 'Check spelling' })).toBeVisible()
    await expect(settings.getByRole('combobox', { name: 'Spelling language' })).toHaveValue(/^fr/)
  })

  test('open file shows what was picked in new tabs', async () => {
    const folder = mkdtempSync(join(tmpdir(), "scb open'file "))
    const path = join(folder, 'note.html')
    writeFileSync(path, titled('Local note'))
    await h.app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as never
    }, path)
    await shortcut(h, 'O')
    await expect(activeTab(h)).toContainText('Local note')
    expect((await snapshot()).tabs.at(-1)!.url).toMatch(/^file:/)
  })
})

test.describe('windows and tools', () => {
  test('a second window has its own tabs and working pages, and goes with its last tab', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await captureMenu()
    await rightClick({ linkURL: site.url('/beta'), linkText: 'Beta' })
    await clickRow('Open link in new window')
    await waitForWindows(2)
    await expect.poll(() => chromeWindows().length).toBe(2)
    const second = chromeWindows().find((page) => page !== h.chrome)!
    await expect(second.getByRole('tab', { selected: true })).toContainText('Beta page')
    // Each window's calls reach its own tabs.
    const firstTabs = await h.chrome.evaluate(() => window.scb.invoke('tabs:snapshot')) as { tabs: { title: string }[] }
    const secondTabs = await second.evaluate(() => window.scb.invoke('tabs:snapshot')) as { tabs: { id: number; title: string }[] }
    expect(firstTabs.tabs.map((tab) => tab.title)).toEqual(['Alpha page'])
    expect(secondTabs.tabs.map((tab) => tab.title)).toEqual(['Beta page'])
    // Tab ids don't repeat between windows.
    expect(await main((g) => g.scbCore.windows.flatMap((w: any) => w.tabs.snapshot().tabs.map((t: any) => t.id)).length)).toBe(2)

    // Pages in the second window get the internal bridge too.
    await second.getByRole('combobox', { name: 'Search or enter address' }).fill('sc://tasks')
    await second.getByRole('combobox', { name: 'Search or enter address' }).press('Enter')
    const tasks = await h.page('sc://tasks')
    await expect(tasks.getByRole('table')).toContainText('Alpha page')

    await main((g, id: number) => g.scbCore.windows[1].tabs.close(id), secondTabs.tabs[0]!.id)
    await waitForWindows(1)
    // The window that's left still works, with a shortcut and a setting reaching it.
    await setSetting(h, { accent: 'teal' })
    await expect(activeTab(h)).toContainText('Alpha page')
  })

  test('closing the only window\'s last tab opens a new one instead', async () => {
    const { id } = (await main((g) => ({ id: g.scbTabs.active.id }))) as { id: number }
    await main((g, tab: number) => g.scbTabs.close(tab), id)
    await expect.poll(async () => (await snapshot()).tabs.length).toBe(1)
    await waitForWindows(1)
  })

  test('all windows open when quitting come back, and one closed by itself doesn\'t', async () => {
    await setSetting(h, { startup: 'restore' })
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await main((g, url: string) => g.scbActions.openWindow(url), site.url('/beta'))
    await main((g, url: string) => g.scbActions.openWindow(url), site.url('/gamma'))
    await waitForWindows(3)
    await expect.poll(() => chromeWindows().length).toBe(3)
    await expect.poll(() => main((g) => g.scbCore.windows.map((w: any) => w.tabs.snapshot().tabs[0]?.title).join())).toContain('Gamma page')
    // Closed by itself.
    await main((g) => g.scbCore.windows[1].window.close())
    await waitForWindows(2)
    await h.close()
    const profile = h.profile
    h = await launch(profile)
    await waitForWindows(2)
    await expect.poll(() => main((g) => g.scbCore.windows.map((w: any) => w.tabs.snapshot().tabs[0]?.title))).toEqual(['Alpha page', 'Gamma page'])
  })

  test('workspaces and settings reach every window', async () => {
    await main((g) => g.scbActions.openWindow())
    await waitForWindows(2)
    await expect.poll(() => chromeWindows().length).toBe(2)
    await main((g) => g.scbCore.storeWorkspaces([...g.scbCore.savedWorkspaces(), { id: 'w2', name: 'Shared', focus: false }]))
    const names = () => main((g) => g.scbCore.windows.map((w: any) => w.tabs.workspaceList().length))
    await expect.poll(names).toEqual([2, 2])
    await main((g) => g.scbCore.removeWorkspace('w2'))
    await expect.poll(names).toEqual([1, 1])
    await setSetting(h, { tabLayout: 'horizontal' })
    const second = chromeWindows().find((page) => page !== h.chrome)!
    await expect(second.getByRole('button', { name: 'New tab' })).toBeVisible()
    await expect(second.getByRole('tablist')).toHaveAttribute('aria-label', 'Tabs')
    await expect(second.getByRole('button', { name: 'Collapse tabs' })).toHaveCount(0)
  })

  test('an installed site has one page and sends everything else to the browser', async () => {
    await main((g, url: string) => g.scbCore.openWindow({ kind: 'app', urls: [url] }), site.url('/links'))
    await waitForWindows(2)
    await expect.poll(() => h.app.windows().some((page) => page.url().includes('window=app'))).toBe(true)
    const bar = h.app.windows().find((page) => page.url().includes('window=app'))!
    await expect(bar.getByText('Links', { exact: true })).toBeVisible()
    await expect(bar.getByRole('tablist')).toHaveCount(0)
    await expect(bar.getByRole('combobox', { name: 'Search or enter address' })).toHaveCount(0)

    const page = await h.page('/links')
    await page.locator('#out').click()
    await expect.poll(titles).toContain('Elsewhere')
    const appTabs = () => main((g) => g.scbCore.windows.find((w: any) => w.kind === 'app').tabs.snapshot().tabs.length)
    expect(await appTabs()).toBe(1)
    await main((g, url: string) => g.scbCore.windows.find((w: any) => w.kind === 'app').tabs.create(url), site.url('/gamma'))
    await expect.poll(titles).toContain('Gamma page')
    expect(await appTabs()).toBe(1)

    const before = (await titles()).length
    await bar.getByRole('button', { name: 'Open in scTerra' }).click()
    await waitForWindows(1)
    await expect.poll(async () => (await titles()).length).toBe(before + 1)
    await expect.poll(titles).toContain('Links')
  })

  test('only web addresses open an installed site from a shortcut', async () => {
    const launchFrom = (argv: string[]) => h.app.evaluate(({ app }, args) => void app.emit('second-instance', {}, args), argv)
    await launchFrom(['scterra', '--sc-app=file:///etc/passwd'])
    await launchFrom(['scterra', '--sc-app=sc://settings'])
    await h.chrome.waitForTimeout(300)
    expect(await main((g) => g.scbCore.windows.map((w: any) => w.kind))).toEqual(['browser'])
    await launchFrom(['scterra', `--sc-app=${site.url('/alpha')}`])
    await expect.poll(() => main((g) => g.scbCore.windows.map((w: any) => w.kind))).toEqual(['browser', 'app'])
  })

  test('starting from a shortcut opens only the site, and the browser still restores later', async () => {
    await setSetting(h, { startup: 'restore' })
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const { profile } = h
    await h.close()
    const executablePath = process.env.SCB_E2E_EXECUTABLE
    const args = ['--no-proxy-server', `--sc-app=${site.url('/beta')}`]
    const app = await electron.launch({
      ...(executablePath ? { executablePath, args } : { args: [...args, resolve(__dirname, '../apps/desktop')] }),
      env: { ...process.env, SCB_USER_DATA_DIR: profile, SCB_E2E: '1', SCB_FILTERS: '/tracker.js', SCTERRA_AI_URL: 'off' } as Record<string, string>
    })
    h = { ...h, app, close: () => app.close() }
    await expect.poll(() => main((g) => g.scbCore?.windows.map((w: any) => w.kind))).toEqual(['app'])
    await main((g) => g.scbCore.browser())
    await expect.poll(() => main((g) => g.scbCore.windows.map((w: any) => w.kind))).toEqual(['app', 'browser'])
    await expect.poll(() => main((g) => g.scbCore.windows[1].tabs.snapshot().tabs[0]?.title)).toBe('Alpha page')
  })

  test('installing a site makes a shortcut, lists it in Settings, and removing it cleans up', async () => {
    const dataHome = mkdtempSync(join(tmpdir(), "scb apps's "))
    await h.close()
    h = await launch(newProfile(), [], { XDG_DATA_HOME: dataHome })
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await h.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never
    })
    await main((g) => g.scbActions.installApp())
    // Whatever this system's shortcut is: a desktop entry, or a Windows or Mac one.
    const shortcuts = () => main((g) => g.scbCore.webApps.all().flatMap((app: { files: string[] }) => app.files).filter((file: string) => !file.endsWith('.png'))) as Promise<string[]>
    await expect.poll(async () => (await shortcuts()).length).toBe(1)
    const [shortcut] = await shortcuts()
    expect(existsSync(shortcut!)).toBe(true)
    if (process.platform === 'linux') {
      expect(shortcut!.startsWith(join(dataHome, 'applications'))).toBe(true)
      const entry = readFileSync(shortcut!, 'utf8')
      expect(entry).toContain('Name=Alpha page')
      expect(entry).toContain(`--sc-app=${site.url('/alpha')}`)
      // What the desktop itself would read: the app that runs, and its quoted arguments.
      expect(spawnableExec(entry).length).toBeGreaterThan(1)
    }

    await go(h, 'sc://settings')
    const settings = await h.page('sc://settings')
    const row = settings.getByRole('region', { name: 'Installed apps' })
    await expect(row).toContainText('Alpha page')
    await row.getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => existsSync(shortcut!)).toBe(false)
    await expect(row).toContainText('No sites installed yet')
  })

  test('the Task Manager lists tabs, ends them, and refuses anything else', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await open('/beta', 'Beta page')
    await main((g) => g.scbActions.openPage('tasks'))
    const page = await h.page('sc://tasks')
    const table = page.getByRole('table')
    await expect(table).toContainText('Alpha page')
    await expect(table).toContainText('scTerra')
    // Nothing of the browser's own can be ended, whatever a page asks for.
    const mainPid = await h.app.evaluate(() => process.pid)
    await page.evaluate((pid) => (window as any).scbInternal.invoke('tasks:end', pid), mainPid)
    const rows = (await page.evaluate(() => (window as any).scbInternal.invoke('tasks:list'))) as { rows: { name: string; kind: string; canEnd: boolean }[] }
    expect(rows.rows.filter((row) => row.kind !== 'Tab').some((row) => row.canEnd)).toBe(false)
    expect(rows.rows.find((row) => row.name.includes('Task Manager'))?.canEnd ?? false).toBe(false)

    await table.getByRole('row', { name: /Beta page/ }).getByRole('button', { name: 'End' }).click()
    await expect.poll(() => main((g) => g.scbTabs.snapshot().tabs.map((tab: any) => tab.url).join())).toContain('sc://error')
  })

  test('developer tools dock at the side, per tab, and give their room back', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const pageWidth = () => main((g) => g.scbTabs.tabs.get(g.scbTabs.active.id).view.getBounds().width) as Promise<number>
    const full = await pageWidth()
    await shortcut(h, 'F12', [])
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBe(460)
    await expect.poll(pageWidth).toBeLessThan(full - 400)
    await expect.poll(() => main((g) => g.scbTabs.tabs.get(g.scbTabs.active.id).devTools.webContents.getURL())).toContain('devtools://')
    await expect(h.chrome.getByRole('separator', { name: 'Developer tools width' })).toBeVisible()

    // A tab without them has the whole width.
    await open('/beta', 'Beta page')
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBe(0)
    await expect.poll(pageWidth).toBe(full)
    await main((g) => g.scbTabs.activateRelative(-1))
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBe(460)

    // The divider's width is kept in settings.
    const divider = h.chrome.getByRole('separator', { name: 'Developer tools width' })
    const box = (await divider.boundingBox())!
    await h.chrome.mouse.move(box.x + box.width / 2, box.y + 100)
    await h.chrome.mouse.down()
    await h.chrome.mouse.move(box.x - 60, box.y + 100, { steps: 4 })
    await h.chrome.mouse.up()
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBeGreaterThan(500)
    expect(await h.chrome.evaluate(() => window.scb.invoke('tabs:snapshot').then((s: any) => s.devToolsWidth))).toBeGreaterThan(500)

    // The test's key presses can land on a hidden tab by now, so these go straight to the action.
    const toggle = () => main((g) => g.scbTabs.toggleDevTools(g.scbTabs.active.id))
    await toggle()
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBe(0)
    await expect.poll(pageWidth).toBe(full)
    await toggle()
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBeGreaterThan(500)
    // Their own close button takes the side bar away too, and F12 from inside them works.
    await expect.poll(() => main((g) => g.scbTabs.tabs.get(g.scbTabs.active.id).devTools?.webContents.getURL())).toContain('devtools://')
    await main((g) => g.scbTabs.tabs.get(g.scbTabs.active.id).devTools.webContents.executeJavaScript('InspectorFrontendHost.closeWindow(); 1'))
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBe(0)
    await toggle()
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBeGreaterThan(500)
    await main((g) => {
      const tools = g.scbTabs.tabs.get(g.scbTabs.active.id).devTools.webContents
      tools.sendInputEvent({ type: 'keyDown', keyCode: 'F12' })
      tools.sendInputEvent({ type: 'keyUp', keyCode: 'F12' })
    })
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBe(0)
    await toggle()
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBeGreaterThan(500)
    // Closing the tab takes them with it, with no errors from the view going away.
    await main((g) => g.scbTabs.close(g.scbTabs.active.id))
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBe(0)
  })

  test('Inspect opens them docked, and they share the width with split view', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await open('/beta', 'Beta page')
    await main((g) => g.scbTabs.toggleSplit())
    await captureMenu()
    await rightClick({})
    await clickRow('Inspect')
    await expect.poll(async () => (await snapshot()).devToolsWidth).toBe(460)
    const fits = await main((g) => {
      const { splitIds, devToolsWidth } = g.scbTabs.snapshot()
      const [left, right] = splitIds.map((id: number) => g.scbTabs.tabs.get(id).view.getBounds())
      const rect = g.scbTabs.page
      return right.x + right.width + 6 + devToolsWidth === rect.x + rect.width && left.x + left.width + 6 === right.x
    })
    expect(fits).toBe(true)
  })
})

test.describe('passwords, autofill and the rest', () => {
  const prompt = async () => (await h.overlay()).getByRole('dialog', { name: 'Save password' })

  test('with no vault, a sign-in offers to set one up, and saving follows', async () => {
    await signIn()
    const dialog = await prompt()
    await dialog.getByRole('button', { name: 'Set up and save' }).click()
    await expect(dialog).toHaveCount(0)
    const page = await h.page('sc://passwords')
    await page.getByRole('textbox', { name: 'Master password', exact: true }).fill(MASTER)
    await page.getByRole('textbox', { name: 'Repeat master password' }).fill(MASTER)
    await page.getByRole('button', { name: 'Create vault' }).click()
    await expect(page.getByRole('region', { name: 'Logins' })).toContainText('sam', { timeout: 15_000 })
  })

  test('while locked, a sign-in offers to unlock, and saving follows', async () => {
    const vault = await createVault()
    await vault.getByRole('button', { name: 'Lock', exact: true }).click()
    await signIn()
    const dialog = await prompt()
    await expect(dialog.getByRole('button', { name: 'Never here' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Unlock and save' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(activeTab(h)).toContainText('Passwords')
    await vault.getByRole('textbox', { name: 'Master password' }).fill(MASTER)
    await vault.getByRole('button', { name: 'Unlock' }).click()
    await expect(vault.getByRole('region', { name: 'Logins' })).toContainText('sam', { timeout: 15_000 })
    // Unlocked, the same login has nothing more to offer.
    await signIn('/login2')
    await (await h.overlay()).waitForTimeout(400)
    await expect(dialog).toHaveCount(0)
  })

  test('"Not now" while locked holds for that site, and unlocking asks properly', async () => {
    const vault = await createVault()
    await vault.getByRole('button', { name: 'Lock', exact: true }).click()
    await signIn()
    const dialog = await prompt()
    await dialog.getByRole('button', { name: 'Not now' }).click()
    await expect(dialog).toHaveCount(0)
    await signIn('/login2')
    await (await h.overlay()).waitForTimeout(400)
    await expect(dialog).toHaveCount(0)

    // With the vault open it can tell this login is new, and asks the usual way.
    await vault.getByRole('textbox', { name: 'Master password' }).fill(MASTER)
    await vault.getByRole('button', { name: 'Unlock' }).click()
    await expect(vault.getByRole('region', { name: 'Logins' })).toBeVisible({ timeout: 15_000 })
    await signIn('/login3')
    await expect(dialog.getByRole('button', { name: 'Never here' })).toBeVisible()
  })

  test('a held login is forgotten when its time is up, even if the vault opens later', async () => {
    await h.close()
    h = await launch(newProfile(), [], { SCB_LOGIN_HOLD_MS: '1500' })
    await signIn()
    const dialog = await prompt()
    await dialog.getByRole('button', { name: 'Set up and save' }).click()
    const page = await h.page('sc://passwords')
    await page.waitForTimeout(1800)
    await page.getByRole('textbox', { name: 'Master password', exact: true }).fill(MASTER)
    await page.getByRole('textbox', { name: 'Repeat master password' }).fill(MASTER)
    await page.getByRole('button', { name: 'Create vault' }).click()
    await expect(page.getByRole('region', { name: 'Logins' })).toContainText('No logins yet', { timeout: 15_000 })
  })

  test('details fill empty form fields only, and never logins or cards', async () => {
    const vault = await createVault()
    const section = vault.getByRole('region', { name: 'Addresses and details' })
    await section.getByRole('button', { name: 'Add' }).click()
    const fill = (label: string, value: string) => section.getByRole('textbox', { name: label, exact: true }).fill(value)
    await fill('Name for this set, like Home or Work', 'Home')
    await fill('Full name', 'Sam Lee')
    await fill('Email', 'sam@example.com')
    await fill('Phone', '0400 000 000')
    await fill('Organisation', 'Should not replace')
    await fill('Address', '1 Test Street')
    await fill('City or suburb', 'Perth')
    await fill('Country', 'Australia')
    await section.getByRole('button', { name: 'Save' }).click()
    await expect(section.getByRole('listitem')).toContainText('Home')

    await main((g, url: string) => g.scbTabs.create(url), site.url('/form'))
    const form = await h.page('/form')
    await expect(form).toHaveTitle('Checkout')
    await captureMenu()
    await rightClick({ isEditable: true })
    await main((g) => g.lastMenu.find((row: { label?: string }) => row.label === 'Fill address or details').submenu[0].click())
    await expect(form.locator('#name')).toHaveValue('Sam Lee')
    await expect(form.locator('#email')).toHaveValue('sam@example.com')
    await expect(form.locator('#phone')).toHaveValue('0400 000 000')
    await expect(form.locator('#street')).toHaveValue('1 Test Street')
    await expect(form.locator('#town')).toHaveValue('Perth')
    await expect(form.locator('#country')).toHaveValue('AU')
    await expect(form.locator('#kept')).toHaveValue('Already here')
    await expect(form.locator('#card')).toHaveValue('')
    await expect(form.locator('#user')).toHaveValue('')
    await expect(form.locator('#pass')).toHaveValue('')
    await expect((await h.overlay()).getByRole('status')).toContainText('Filled 6 fields')

    // Locked, it only offers the way to the vault.
    await main((g) => g.scbCore.passwords.lock())
    await rightClick({ isEditable: true })
    expect(await menuLabels()).toContain('Fill address or details…')
  })

  test('details never reach the browser UI or websites', async () => {
    const vault = await createVault()
    const page = await (async () => {
      await main((g, url: string) => g.scbTabs.create(url), site.url('/alpha'))
      return h.page('/alpha')
    })()
    expect(await page.evaluate(() => typeof (window as any).scbInternal)).toBe('undefined')
    await expect(h.chrome.evaluate(() => window.scb.invoke('autofill:list'))).rejects.toThrow()
    expect(await vault.evaluate(() => (window as any).scbInternal.invoke('autofill:list'))).toEqual([])
  })

  test('an extension can be turned off, stays off after a restart, and comes back', async () => {
    const fixture = resolve(__dirname, 'fixtures/extension')
    const id = (await h.app.evaluate((_, path) => (globalThis as unknown as { scbExtensions: { add(p: string): Promise<string> } }).scbExtensions.add(path), fixture)) as string
    const list = () => main((g) => g.scbExtensions.list()) as Promise<{ id: string; enabled: boolean }[]>
    const loaded = (extension: string) => h.app.evaluate(({ session }, wanted) => !!session.defaultSession.extensions.getExtension(wanted), extension)
    expect((await list())[0]).toMatchObject({ id, enabled: true })

    await go(h, 'sc://settings')
    const settings = await h.page('sc://settings')
    const toggle = settings.getByRole('switch', { name: /^Turn on/ })
    await toggle.click()
    await expect.poll(() => loaded(id)).toBe(false)
    expect((await list())[0]).toMatchObject({ id, enabled: false })

    await restart()
    await expect.poll(async () => (await list())[0]?.enabled).toBe(false)
    await h.chrome.waitForTimeout(500)
    expect(await loaded(id)).toBe(false)

    await main((g, extension: string) => g.scbExtensions.setEnabled(extension, true), id)
    await expect.poll(() => loaded(id)).toBe(true)
    await main((g, extension: string) => g.scbExtensions.setEnabled(extension, false), id)
    await main((g, extension: string) => g.scbExtensions.remove(extension), id)
    expect(await list()).toEqual([])
  })

  test('translate takes a language, goes between them and back, and asks only when told', async () => {
    const mock = await startAiMock()
    try {
      await go(h, 'sc://ai')
      const ai = await h.page('sc://ai')
      await ai.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
      await ai.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
      await ai.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
      await ai.getByRole('button', { name: 'Add provider' }).click()
      await expect(ai.getByText('Connected, 1 model available')).toBeVisible()
      await ai.getByRole('combobox', { name: 'Chat model for Mock AI' }).selectOption('mock-model')

      await setSetting(h, { translateEngine: 'ai' })
      await go(h, site.url('/hello'))
      const page = await h.page('/hello')
      await expect(page).toHaveTitle('Hello')
      await captureMenu()
      await rightClick({})
      const rows = (await main((g) => g.lastMenu.find((row: { label?: string }) => row.label === 'Translate page').submenu.map((row: { label?: string }) => row.label))) as string[]
      expect(rows[0]).toContain('English')
      expect(rows).toContain('Spanish')
      expect(rows.slice(1)).not.toContain('English')
      expect(mock.requests.filter((request) => JSON.stringify(request.body).includes('Translate'))).toHaveLength(0)

      mock.queue = ['["Buenos días"]']
      await main((g) => g.scbActions.translatePage('Spanish'))
      await expect(page.locator('h1')).toHaveText('Buenos días')
      expect(JSON.stringify(mock.requests.at(-1)?.body)).toContain('Spanish')
      await expect.poll(() => main((g) => g.scbActions.translateLanguage())).toBe('Spanish')

      // Another language goes there directly.
      mock.queue = ['["Guten Morgen"]']
      await main((g) => g.scbActions.translatePage('German'))
      await expect(page.locator('h1')).toHaveText('Guten Morgen')

      // The same language again goes back.
      await main((g) => g.scbActions.translatePage())
      await expect(page.locator('h1')).toHaveText('Good morning')
    } finally {
      mock.server.closeAllConnections()
      mock.server.close()
    }
  })

  test('Google Translate is the default, sends only when asked, and says when it can\'t', async () => {
    const received: string[] = []
    let answer = true
    const google = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const params = new URLSearchParams(body)
        received.push(`${new URL(req.url!, 'http://x').searchParams.get('tl')}:${params.getAll('q').join('|')}`)
        res.writeHead(answer ? 200 : 429, { 'content-type': 'application/json' })
        res.end(answer ? JSON.stringify(params.getAll('q').map((text) => [`es-${text}`, 'en'])) : 'Sorry')
      })
    })
    await new Promise<void>((done) => google.listen(0, '127.0.0.1', done))
    const { port } = google.address() as AddressInfo
    await h.close()
    h = await launch(newProfile(), [], { SCB_TRANSLATE_URL: `http://127.0.0.1:${port}` })
    try {
      await go(h, site.url('/hello'))
      const page = await h.page('/hello')
      await expect(page).toHaveTitle('Hello')
      expect(received).toEqual([])
      const overlay = await h.overlay()
      await main((g) => g.scbActions.translatePage('Spanish'))
      await expect(page.locator('h1')).toHaveText('es-Good morning')
      expect(received[0]).toBe('es:Good morning')
      await expect(overlay.getByRole('status')).toContainText('Translated')
      await main((g) => g.scbActions.translatePage())
      await expect(page.locator('h1')).toHaveText('Good morning')

      answer = false
      await main((g) => g.scbActions.translatePage('French'))
      await expect(overlay.getByRole('status')).toContainText("Google Translate didn't answer")
      await expect(page.locator('h1')).toHaveText('Good morning')
    } finally {
      google.closeAllConnections()
      google.close()
    }
  })

  test('side tabs line up with the New tab row', async () => {
    await setSetting(h, { tabLayout: 'vertical', verticalTabsCollapsed: false })
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const row = h.chrome.getByRole('button', { name: 'New tab', exact: true })
    const tabBox = activeTab(h).locator('span.size-5').first()
    await expect(tabBox).toBeVisible()
    const tabIcon = (await tabBox.boundingBox())!
    const rowIcon = (await row.locator('span.size-5').boundingBox())!
    expect(Math.abs(tabIcon.x - rowIcon.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(tabIcon.width - rowIcon.width)).toBeLessThanOrEqual(1)
  })

  test("every page of the browser's own has an icon, and source views too", async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    for (const [address, icon] of [['sc://vpn', 'lucide-network'], ['sc://passwords', 'lucide-key-round'], ['sc://blocker', 'lucide-shield-ban'], ['sc://tasks', 'lucide-activity']] as const) {
      await go(h, address)
      await expect(activeTab(h).locator(`svg.${icon}`)).toBeVisible()
    }
    await go(h, `view-source:${site.url('/alpha')}`)
    await expect(activeTab(h).locator('svg.lucide-code-xml')).toBeVisible()
  })

  test('the update screen covers the window and leaves if installing stops', async () => {
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const setPhase = (patch: object) => main((g, value: object) => g.scbUpdates.set(value), patch)
    const pageShown = () => main((g) => g.scbTabs.tabs.get(g.scbTabs.active.id).view.getVisible())
    await expect.poll(pageShown).toBe(true)
    await setPhase({ phase: 'installing', version: '9.9.9' })
    await expect(h.chrome.getByRole('status').filter({ hasText: 'Updating scTerra to 9.9.9' })).toBeVisible()
    await expect.poll(pageShown).toBe(false)
    await setPhase({ phase: 'error', error: 'It failed' })
    await expect(h.chrome.getByText('Updating scTerra')).toHaveCount(0)
    await expect.poll(pageShown).toBe(true)
  })
})

test.describe('extensions in a panel', () => {
  const addExtension = (name: string) =>
    h.app.evaluate((_, path) => (globalThis as unknown as { scbExtensions: { add(p: string): Promise<string> } }).scbExtensions.add(path), resolve(__dirname, `fixtures/${name}`)) as Promise<string>
  const windowCount = () => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length)
  /** The page in the panel, found in the window's views. */
  const panel = () =>
    main((g) => {
      const view = g.scbExtensions.popover.view
      return view ? { url: view.webContents.getURL(), bounds: view.getBounds(), visible: view.getVisible() } : null
    }) as Promise<{ url: string; bounds: { x: number; y: number; width: number; height: number }; visible: boolean } | null>
  const list = async () => (await h.overlay()).getByRole('dialog', { name: 'Extensions' })

  test.beforeEach(async () => {
    await h.close()
    h = await launch(undefined, [], { SCB_E2E_SANDBOX: '1' })
  })

  test('the Extensions button opens a list, and picking one opens its popup under the button, with no new window', async () => {
    await addExtension('action-extension')
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const before = await windowCount()
    const button = h.chrome.getByRole('button', { name: 'Extensions' })
    await button.click()
    const dialog = await list()
    await expect(dialog.getByRole('button', { name: 'Action extension', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Manage extensions' })).toBeVisible()
    const anchor = (await button.boundingBox())!
    await dialog.getByRole('button', { name: 'Action extension', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await panel())?.visible).toBe(true)
    const shown = (await panel())!
    expect(shown.url).toContain('/popup.html')
    expect(await windowCount()).toBe(before)
    expect(shown.bounds.y).toBeGreaterThanOrEqual(anchor.y + anchor.height)
    expect(shown.bounds.x + shown.bounds.width).toBeLessThanOrEqual(anchor.x + anchor.width + 1)
    // Its frame is drawn in the overlay, with the page above that.
    await expect.poll(() => main((g) => g.scbTabs.window.contentView.children.at(-1) === g.scbExtensions.popover.view)).toBe(true)
    // The extension's APIs work from here, and reach the real tabs.
    await expect.poll(() => main((g) => g.scbExtensions.popover.view.webContents.getTitle())).toMatch(/^Tabs: [1-9]/)
    // Pressing it again closes it.
    await main((g, id: string) => g.scbExtensions.open(id), new URL(shown.url).host)
    await expect.poll(panel).toBeNull()
  })

  test('a popup sizes the panel to what it draws, even after loading', async () => {
    const id = await addExtension('big-popup-extension')
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await main((g, ext: string) => g.scbExtensions.open(ext), id)
    await expect.poll(async () => (await panel())?.bounds.width, { timeout: 8000 }).toBe(380)
    await expect.poll(async () => (await panel())?.bounds.height, { timeout: 8000 }).toBe(520)
  })

  test('the toolbar button for a pinned extension opens the same panel', async () => {
    const id = await addExtension('action-extension')
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const before = await windowCount()
    await h.chrome.locator(`browser-action-list [id="${id}"]`).click()
    await expect.poll(async () => (await panel())?.url).toContain('/popup.html')
    expect(await windowCount()).toBe(before)
  })

  test('escape, a tab change and the page asking all close it', async () => {
    const id = await addExtension('action-extension')
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const open = async () => {
      await main((g, ext: string) => g.scbExtensions.open(ext), id)
      await expect.poll(async () => (await panel())?.visible).toBe(true)
    }
    await open()
    await main((g) => {
      const { webContents } = g.scbExtensions.popover.view
      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    })
    await expect.poll(panel).toBeNull()
    await h.chrome.waitForTimeout(300)
    await open()
    await main((g) => g.scbExtensions.popover.view.webContents.executeJavaScript('window.close()'))
    await expect.poll(panel).toBeNull()
    await h.chrome.waitForTimeout(300)
    await open()
    await main((g, url: string) => g.scbTabs.create(url), site.url('/beta'))
    await expect.poll(panel).toBeNull()
  })

  test('a side panel extension opens in the panel, from its button and its own call', async () => {
    const id = await addExtension('side-panel-extension')
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const before = await windowCount()
    const button = h.chrome.locator(`browser-action-list [id="${id}"]`)
    // The extension asks for this as it starts, and the button toggles, so it's only pressed while closed.
    await expect(async () => {
      if (!(await panel())) await button.click()
      await expect.poll(async () => (await panel())?.url, { timeout: 3000 }).toContain('/panel.html')
    }).toPass()
    await expect.poll(async () => (await panel())?.visible).toBe(true)
    expect(await windowCount()).toBe(before)
    expect((await panel())!.bounds.width).toBe(400)
    // There's no sidebar taking room from the page.
    await expect(h.chrome.getByRole('complementary', { name: 'Side panel extension side panel' })).toHaveCount(0)
  })

  test('a small window from an extension opens in the panel, and it can close it', async () => {
    const id = await addExtension('action-extension')
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await main((g, url: string) => g.scbTabs.create(url), `chrome-extension://${id}/page.html`)
    await expect(activeTab(h)).toContainText('Extension page')
    const page = await h.page(`chrome-extension://${id}/page.html`)
    const before = await windowCount()
    const created = await page.evaluate(() => (globalThis as any).chrome.windows.create({ url: 'page.html?popup', type: 'popup', width: 500, height: 300 }))
    await expect.poll(async () => (await panel())?.url).toContain('page.html?popup')
    expect(await windowCount()).toBe(before)
    await expect.poll(async () => (await panel())?.bounds.width).toBe(500)
    await page.evaluate((windowId) => (globalThis as any).chrome.windows.remove(windowId), created.id)
    await expect.poll(panel).toBeNull()
    expect(await windowCount()).toBe(before)
  })

  test('pins can be changed from the list, and Settings brings the old way back', async () => {
    const id = await addExtension('action-extension')
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    await h.chrome.getByRole('button', { name: 'Extensions' }).click()
    const dialog = await list()
    await dialog.getByRole('button', { name: 'Unpin Action extension' }).click()
    await expect(h.chrome.locator(`browser-action-list [id="${id}"]`)).toBeHidden()
    await dialog.getByRole('button', { name: 'Manage extensions' }).click()
    const settings = await h.page('sc://settings')
    await expect(settings.getByRole('combobox', { name: 'Open extensions in' })).toHaveValue('panel')
    await settings.getByRole('combobox', { name: 'Open extensions in' }).selectOption('window')
    await expect.poll(() => main((g) => g.scbExtensions.summary().display)).toBe('window')
    const before = await windowCount()
    await h.chrome.evaluate((ext) => window.scb.invoke('extensions:open', ext), id)
    await expect.poll(windowCount).toBe(before + 1)
    expect(await panel()).toBeNull()
  })
})

/** Splits an Exec line the way the Desktop Entry spec says to, undoing both rounds of escaping. */
function spawnableExec(entry: string): string[] {
  const line = /^Exec=(.*)$/m.exec(entry)![1]!
  return [...line.matchAll(/"((?:[^"\\]|\\\\.)*)"/g)].map((match) => match[1]!.replace(/\\\\(.)/g, '$1').replace(/%%/g, '%'))
}
