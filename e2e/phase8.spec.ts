import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { go, launch, serveSite, setSetting, shortcut, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock

const MASTER = 'a long master password'
const LOGIN_PAGE = `<!doctype html><title>Sign in</title>
<p>PAGE-WORDS</p>
<form onsubmit="event.preventDefault(); document.title = 'Signed in as ' + document.getElementById('u').value">
  <input id="u" name="username"><input id="p" name="password" type="password"><button>Sign in</button>
</form>`

const reportText = (title: string, body: string) =>
  ['Here it is.', '```scterra-report', JSON.stringify({ title, summary: 'Short.', theme: 'clean', blocks: [{ type: 'paragraph', text: body }, { type: 'list', ordered: true, items: ['One'] }, { type: 'table', headers: ['', 'A'], rows: [['x', '1']] }] }), '```'].join('\n')

test.beforeEach(async () => {
  mock = await startAiMock()
  site = await serveSite({ '/login': LOGIN_PAGE })
  h = await launch()
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  mock.server.closeAllConnections()
  mock.server.close()
  site.server.close()
})

async function addProvider() {
  await go(h, 'sc://ai')
  const page = await h.page('sc://ai')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await page.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await page.getByRole('button', { name: 'Add provider' }).click()
  await expect(page.getByText('Connected, 1 model available')).toBeVisible()
  await page.getByRole('combobox', { name: 'Chat model for Mock AI' }).selectOption('mock-model')
}

async function createVault() {
  await go(h, 'sc://passwords')
  const page = await h.page('sc://passwords')
  await page.getByRole('textbox', { name: 'Master password', exact: true }).fill(MASTER)
  await page.getByRole('textbox', { name: 'Repeat master password' }).fill(MASTER)
  await page.getByRole('button', { name: 'Create vault' }).click()
  await expect(page.getByRole('region', { name: 'Logins' })).toBeVisible({ timeout: 15_000 })
  return page
}

/** Native menus can't be clicked from a test, so this keeps the rows the app builds. */
const captureMenu = () =>
  h.app.evaluate(({ Menu }) => {
    const realm = globalThis as unknown as { lastMenu: unknown }
    Menu.buildFromTemplate = ((template: unknown) => {
      realm.lastMenu = template
      return { popup: () => undefined }
    }) as never
  })
const clickMenuRow = (label: string) =>
  h.app.evaluate((_, wanted) => {
    const rows = (globalThis as unknown as { lastMenu: { label?: string; click?: () => void }[] }).lastMenu
    rows.find((row) => row.label === wanted)!.click!()
  }, label)

test('the vault offers to save a sign-in, fills it back, and keeps it sealed', async () => {
  await createVault()
  await expect(h.chrome.getByRole('button', { name: 'Passwords', exact: true })).toBeVisible()

  await go(h, site.url('/login'))
  const login = await h.page('/login')
  await expect(login).toHaveTitle('Sign in')
  await login.locator('#u').fill('sam')
  await login.locator('#p').fill('hunter2-secret')
  await login.getByRole('button', { name: 'Sign in' }).click()
  await expect(login).toHaveTitle('Signed in as sam')

  const overlay = await h.overlay()
  const prompt = overlay.getByRole('dialog', { name: 'Save password' })
  await expect(prompt).toContainText('sam')
  await expect(prompt).not.toContainText('hunter2')
  await prompt.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(prompt).toHaveCount(0)

  // Filling from the menu, into this exact site. Filling by itself on load is tested in release045.
  await setSetting(h, { passwordAutoFill: false })
  await login.reload()
  await expect(login.locator('#p')).toHaveValue('')
  await captureMenu()
  await shortcut(h, 'L', ['control', 'shift'])
  await expect.poll(() => h.app.evaluate(() => Array.isArray((globalThis as unknown as { lastMenu?: unknown }).lastMenu))).toBe(true)
  await clickMenuRow('sam')
  await expect(login.locator('#u')).toHaveValue('sam')
  await expect(login.locator('#p')).toHaveValue('hunter2-secret')

  await go(h, 'sc://passwords')
  const passwords = await h.page('sc://passwords')
  const row = passwords.getByRole('listitem').filter({ hasText: 'sam' })
  await expect(row).not.toContainText('hunter2')
  await row.getByRole('button', { name: 'Show password' }).click()
  await expect(row).toContainText('hunter2-secret')

  await passwords.getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(passwords.getByRole('form', { name: 'Unlock passwords' })).toBeVisible()
  await expect(h.chrome.getByRole('button', { name: 'Passwords (locked)' })).toBeVisible()
  await passwords.getByRole('textbox', { name: 'Master password' }).fill('the wrong password')
  await passwords.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(passwords.getByRole('alert')).toContainText("isn't the master password")

  const profile = h.profile
  await h.close()
  for (const file of ['browser.db', 'browser.db-wal']) {
    if (existsSync(join(profile, file))) expect(readFileSync(join(profile, file), 'latin1')).not.toContain('hunter2')
  }
})

test('nothing is offered or watched while locked, if that option is off', async () => {
  const passwords = await createVault()
  await passwords.getByRole('checkbox', { name: 'Also offer while locked' }).uncheck()
  await passwords.getByRole('button', { name: 'Lock', exact: true }).click()
  await go(h, site.url('/login'))
  const login = await h.page('/login')
  await login.locator('#u').fill('sam')
  await login.locator('#p').fill('secret')
  await login.getByRole('button', { name: 'Sign in' }).click()
  await expect(login).toHaveTitle('Signed in as sam')
  const overlay = await h.overlay()
  await overlay.waitForTimeout(400)
  await expect(overlay.getByRole('dialog', { name: 'Save password' })).toHaveCount(0)
})

test('bookmark folders nest, and deleting one keeps what was inside', async () => {
  await h.chrome.evaluate(async () => {
    await window.scb.invoke('bookmarks:toggle', 'https://a.example/', 'Alpha')
  })
  await go(h, 'sc://bookmarks')
  const page = await h.page('sc://bookmarks')
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Work')
  await page.getByRole('button', { name: 'Add folder' }).click()
  await page.getByRole('button', { name: 'Add a folder inside Work' }).click()
  await page.getByRole('textbox', { name: 'New folder inside Work' }).fill('Reports')
  await page.getByRole('textbox', { name: 'New folder inside Work' }).press('Enter')
  const inner = page.getByRole('region', { name: 'Reports' })
  await expect(page.getByRole('region', { name: 'Work' }).getByRole('region', { name: 'Reports' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Folder for Alpha' }).selectOption({ label: 'Work / Reports' })
  await expect(inner.getByRole('link', { name: 'Alpha' })).toBeVisible()

  // Only top-level folders sit on the bar.
  const bar = h.chrome.getByRole('toolbar', { name: 'Bookmarks' })
  await expect(bar.getByRole('button', { name: 'Work' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Reports' })).toHaveCount(0)

  // A folder can't be moved inside itself.
  await expect(page.getByRole('combobox', { name: 'Move folder Work' }).getByRole('option')).toHaveCount(1)

  await inner.getByRole('button', { name: 'Delete folder' }).click()
  await expect(page.getByRole('region', { name: 'Work' }).getByRole('link', { name: 'Alpha' })).toBeVisible()
})

test('asking for a change makes a new version, and each can be read, redesigned and saved as Word', async () => {
  await addProvider()
  mock.queue = [reportText('Launch plan', 'First draft'), reportText('Launch plan', 'Second draft')]
  await go(h, 'sc://assistant')
  const page = await h.page('sc://assistant')
  await page.getByRole('textbox', { name: 'Message the assistant' }).fill('Plan it')
  await page.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
  const pane = page.getByRole('region', { name: 'Report' })
  await expect(pane.locator('article.sc-report')).toContainText('First draft')
  await expect(pane.getByRole('navigation', { name: 'Versions' })).toHaveCount(0)

  await pane.getByRole('textbox', { name: 'Change to make' }).fill('Make it shorter')
  await pane.getByRole('textbox', { name: 'Change to make' }).press('Enter')
  await expect(pane.locator('article.sc-report')).toContainText('Second draft')
  const versions = pane.getByRole('navigation', { name: 'Versions' })
  await expect(versions).toContainText('Version 2 of 2')
  await versions.getByRole('button', { name: 'Earlier version' }).click()
  await expect(pane.locator('article.sc-report')).toContainText('First draft')
  await expect(versions).toContainText('Version 1 of 2')

  await pane.getByRole('combobox', { name: 'Design' }).selectOption('editorial')
  await expect(pane.locator('article.sc-report')).toHaveAttribute('data-theme', 'editorial')

  const folder = mkdtempSync(join(tmpdir(), 'scb-word-'))
  const file = join(folder, 'out.docx')
  await h.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, file)
  await pane.getByRole('button', { name: 'Download' }).click()
  await pane.getByRole('menuitem', { name: 'Word document' }).click()
  await expect(pane.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  expect(readFileSync(file).subarray(0, 2).toString()).toBe('PK')
  rmSync(folder, { recursive: true, force: true })
})

test('the panel asks for changes too, without sending the page', async () => {
  await addProvider()
  await h.chrome.evaluate(() => window.scb.invoke('settings:set', { assistantWidth: 400 }))
  await go(h, site.url('/login'))
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  const panel = h.chrome.getByRole('complementary', { name: 'Assistant' })
  mock.queue = [reportText('Plan', 'One'), reportText('Plan', 'Two')]
  await panel.getByRole('textbox', { name: 'Message the assistant' }).fill('Plan it')
  await panel.getByRole('textbox', { name: 'Message the assistant' }).press('Enter')
  await panel.getByRole('button', { name: 'Open report' }).click()
  const pane = h.chrome.getByRole('region', { name: 'Report' })
  await pane.getByRole('textbox', { name: 'Change to make' }).fill('Shorter')
  await pane.getByRole('textbox', { name: 'Change to make' }).press('Enter')
  await expect(pane.locator('article.sc-report')).toContainText('Two')
  await expect(pane.getByRole('navigation', { name: 'Versions' })).toContainText('Version 2 of 2')
  const sent = JSON.stringify(mock.requests.at(-1))
  expect(sent).toContain('Shorter')
  expect(sent).not.toContain('PAGE-WORDS')
})

test('closing the browser raises no errors', async () => {
  let output = ''
  const collect = (data: Buffer) => (output += data.toString())
  h.app.process().stdout?.on('data', collect)
  h.app.process().stderr?.on('data', collect)
  await h.close()
  expect(output).not.toContain('Uncaught exception')
})

test('sidebars drag wider, from the keyboard too, and remember it', async () => {
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  // Without focus is the hard case: the drag used to end early when the page stepped aside.
  await h.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.blur())
  const panel = h.chrome.getByRole('complementary', { name: 'Assistant' })
  const handle = h.chrome.getByRole('separator', { name: 'Assistant width' })
  const before = (await panel.boundingBox())!.width
  const box = (await handle.boundingBox())!
  await h.chrome.mouse.move(box.x + 2, box.y + 200)
  await h.chrome.mouse.down()
  await h.chrome.mouse.move(box.x - 50, box.y + 200, { steps: 3 })
  // Displays with no window manager send one of these as the page steps aside. It's not a release.
  await h.chrome.evaluate(() => void window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, buttons: 0 })))
  await h.chrome.mouse.move(box.x - 98, box.y + 200, { steps: 3 })
  await h.chrome.mouse.up()
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(before + 100))
  await handle.focus()
  await handle.press('ArrowLeft')
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(before + 116))

  const sidebar = h.chrome.getByRole('separator', { name: 'Sidebar width' })
  await sidebar.focus()
  await sidebar.press('ArrowRight')
  const profile = h.profile
  await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('settings:get') as Promise<{ sidebarWidth: number }>).then((s) => s.sidebarWidth)).toBe(256)
  await h.close()

  h = await launch(profile)
  await h.chrome.getByRole('button', { name: 'Assistant' }).click()
  await expect.poll(async () => Math.round((await h.chrome.getByRole('complementary', { name: 'Assistant' }).boundingBox())!.width)).toBe(Math.round(before + 116))
})

const proxyFor = (url: string) => h.app.evaluate(({ session }, address) => session.defaultSession.resolveProxy(address), url)

test('sites on the skip list go direct, and connecting at start keeps pages back until it works', async () => {
  await go(h, 'sc://vpn')
  const page = await h.page('sc://vpn')
  await page.getByRole('textbox', { name: 'Connection links' }).fill('http://127.0.0.1:9#Nothing here')
  await page.getByRole('button', { name: 'Add links' }).click()
  await expect(page.getByRole('status')).toContainText('Added 1')
  const list = page.getByRole('textbox', { name: 'Sites that skip the VPN' })
  await list.fill('https://Bank.example.com/login\nnot a site!')
  await list.blur()
  await expect(list).toHaveValue('bank.example.com\nnot\na')
  await list.fill('bank.example.com')
  await list.blur()
  await page.getByRole('switch', { name: 'VPN', exact: true }).click()
  await expect.poll(() => proxyFor('http://other.example.com/')).toContain('127.0.0.1')
  expect(await proxyFor('http://bank.example.com/')).toBe('DIRECT')
  expect(await proxyFor('http://www.bank.example.com/')).toBe('DIRECT')

  await setSetting(h, { vpnAutoConnect: true })
  const profile = h.profile
  await h.close()
  h = await launch(profile)
  await expect.poll(() => proxyFor('http://other.example.com/')).toContain('127.0.0.1')
})
