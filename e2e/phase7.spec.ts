import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launch, serveSite, shortcut, titled } from './app'

const until = async (check: () => Promise<boolean>) => {
  await expect.poll(check, { timeout: 10_000 }).toBe(true)
}

test('a site asking for a password gets an answer from the sign-in box', async () => {
  const server = createServer((request, response) => {
    if (request.headers.authorization === `Basic ${Buffer.from('ada:lovelace').toString('base64')}`) return response.end('<title>Inside</title>signed in')
    response.writeHead(401, { 'www-authenticate': 'Basic realm="Staff area"' }).end('no')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const app = await launch()
  await app.chrome.getByRole('combobox').fill(`http://127.0.0.1:${port}/`)
  await app.chrome.getByRole('combobox').press('Enter')
  const overlay = await app.overlay()
  const dialog = overlay.getByRole('dialog', { name: 'Sign in' })
  await expect(dialog).toContainText(`Sign in to 127.0.0.1:${port}`)
  await expect(dialog).toContainText('Staff area')
  await expect(dialog).toContainText("isn't encrypted")
  await overlay.getByLabel('Username').fill('ada')
  await overlay.getByLabel('Password').fill('lovelace')
  await overlay.getByRole('button', { name: 'Sign in' }).click()
  await expect(app.chrome.getByRole('tab', { name: 'Inside' })).toBeVisible()
  await app.close()
  server.close()
})

test('zoom is remembered for each site across restarts', async () => {
  const site = await serveSite({ '/': titled('Page') })
  const app = await launch()
  await app.chrome.getByRole('combobox').fill(site.url('/'))
  await app.chrome.getByRole('combobox').press('Enter')
  await until(async () => (await app.app.evaluate(() => (globalThis as never as { scbTabs: { active: { url: string } } }).scbTabs.active.url)).startsWith('http'))
  await app.app.evaluate(() => {
    const { scbTabs } = globalThis as never as { scbTabs: { active: { id: number }; setZoom: (id: number, factor: number) => void } }
    scbTabs.setZoom(scbTabs.active.id, 1.5)
  })
  await app.close()
  const second = await launch(app.profile)
  await until(async () => second.app.evaluate(() => (globalThis as never as { scbTabs: { active: { zoomPercent: number } } }).scbTabs.active?.zoomPercent === 150))
  await second.close()
  site.server.close()
})

test('split view comes back after a restart', async () => {
  const site = await serveSite({ '/': titled('Page') })
  const app = await launch()
  await app.app.evaluate(({}, url) => {
    const { scbTabs } = globalThis as never as { scbTabs: { create: (url: string) => number; toggleSplit: () => void; activateIndex: (n: number) => void } }
    scbTabs.create(url)
    scbTabs.activateIndex(1)
    scbTabs.toggleSplit()
  }, site.url('/'))
  await expect.poll(() => app.app.evaluate(() => (globalThis as never as { scbTabs: { snapshot: () => { splitIds: number[] } } }).scbTabs.snapshot().splitIds.length)).toBe(2)
  await new Promise((resolve) => setTimeout(resolve, 1300))
  await app.close()
  const second = await launch(app.profile)
  await expect.poll(() => second.app.evaluate(() => (globalThis as never as { scbTabs: { snapshot: () => { splitIds: number[] } } }).scbTabs.snapshot().splitIds.length)).toBe(2)
  await second.close()
  site.server.close()
})

test('workspaces keep separate tabs, and survive a restart', async () => {
  const app = await launch()
  const { chrome } = app
  await chrome.getByRole('button', { name: 'New workspace' }).click()
  const overlay = await app.overlay()
  await overlay.getByLabel('Workspace name').fill('Study')
  await overlay.getByRole('button', { name: 'Create' }).click()
  await expect(chrome.getByRole('button', { name: 'Study', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(chrome.getByRole('tab')).toHaveCount(1)
  await shortcut(app, 't')
  await expect(chrome.getByRole('tab')).toHaveCount(2)
  await chrome.getByRole('button', { name: 'Personal', exact: true }).click()
  await expect(chrome.getByRole('tab')).toHaveCount(1)
  await chrome.getByRole('button', { name: 'Study', exact: true }).click()
  await expect(chrome.getByRole('tab')).toHaveCount(2)
  await new Promise((resolve) => setTimeout(resolve, 1300))
  await app.close()
  const second = await launch(app.profile)
  await expect(second.chrome.getByRole('button', { name: 'Study', exact: true })).toBeVisible()
  await second.close()
})

test('clean up offers duplicates, and closes only what is ticked', async () => {
  const site = await serveSite({ '/': titled('Page') })
  const app = await launch()
  await app.app.evaluate(({}, url) => {
    const { scbTabs } = globalThis as never as { scbTabs: { create: (url: string) => number } }
    scbTabs.create(url)
    scbTabs.create(url)
    scbTabs.create(url)
  }, site.url('/'))
  await expect(app.chrome.getByRole('tab')).toHaveCount(4)
  await app.chrome.getByRole('button', { name: 'Clean up tabs' }).click()
  const overlay = await app.overlay()
  const dialog = overlay.getByRole('dialog', { name: 'Clean up tabs' })
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await dialog.getByRole('checkbox').first().click()
  await dialog.getByRole('button', { name: 'Close 1 tab' }).click()
  await expect(app.chrome.getByRole('tab')).toHaveCount(3)
  await app.close()
  site.server.close()
})

test('toolbar buttons can be moved, and reset', async () => {
  const app = await launch()
  const { chrome } = app
  const slots = () => chrome.locator('[data-toolbar-slot]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-toolbar-slot')))
  await chrome.locator('[data-toolbar-slot="reload"]').dragTo(chrome.locator('[data-toolbar-slot="omnibox"]'), { targetPosition: { x: 600, y: 12 } })
  await expect.poll(slots).toEqual(['back', 'forward', 'vpn', 'omnibox', 'reload', 'downloads', 'passwords', 'extensions'])
  const assistant = await chrome.getByRole('button', { name: 'Assistant' }).boundingBox()
  const menu = await chrome.getByRole('button', { name: 'Menu' }).boundingBox()
  const box = await chrome.getByRole('combobox', { name: 'Search or enter address' }).boundingBox()
  expect(assistant!.x).toBeGreaterThan(box!.x + box!.width)
  expect(menu!.x).toBeGreaterThan(assistant!.x)
  await app.close()
})

test('the intro plays on a first run and is not shown again', async () => {
  const app = await launch(undefined, [], { SCB_WELCOME: '1' })
  const page = await app.page('sc://welcome')
  await expect(page.getByRole('heading', { name: 'scTerra' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip intro' }).click()
  await expect(page.getByRole('heading', { name: 'Bring your world with you' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip setup' }).click()
  await expect.poll(() => app.app.evaluate(() => (globalThis as never as { scbTabs: { active: { url: string } } }).scbTabs.active.url), { timeout: 8000 }).toContain('sc://newtab')
  await app.close()
  const second = await launch(app.profile, [], { SCB_WELCOME: '1' })
  await expect.poll(() => second.app.evaluate(() => (globalThis as never as { scbTabs: { active: { url: string } } }).scbTabs.active?.url ?? '')).toContain('sc://newtab')
  await second.close()
})

/** A one-page PDF holding only a JPEG, as a scanner would make. */
function scannedPdf(jpeg: Buffer, width: number, height: number): Buffer {
  const parts: Buffer[] = []
  const offsets: number[] = []
  let length = 0
  const write = (data: string | Buffer) => {
    const chunk = typeof data === 'string' ? Buffer.from(data, 'latin1') : data
    parts.push(chunk)
    length += chunk.length
  }
  const object = (id: number, body: string | (() => void)) => {
    offsets[id] = length
    write(`${id} 0 obj\n`)
    if (typeof body === 'string') write(body)
    else body()
    write('\nendobj\n')
  }
  write('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /I 5 0 R >> >> >>`)
  const draw = `q ${width} 0 0 ${height} 0 0 cm /I Do Q`
  object(4, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)
  object(5, () => {
    write(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
    write(jpeg)
    write('\nendstream')
  })
  const table = length
  write(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`)
  return Buffer.concat(parts)
}

test('a scanned PDF is read on this computer and can be searched', async () => {
  test.setTimeout(90_000)
  const app = await launch()
  const jpeg = Buffer.from(
    await app.chrome.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 900
      canvas.height = 500
      const ink = canvas.getContext('2d')!
      ink.fillStyle = 'white'
      ink.fillRect(0, 0, 900, 500)
      ink.fillStyle = 'black'
      ink.font = '48px serif'
      ink.fillText('The launch code is marigold', 60, 200)
      return canvas.toDataURL('image/jpeg', 0.95).split(',')[1]!
    }),
    'base64'
  )
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/pdf' })
    response.end(scannedPdf(jpeg, 900, 500))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  await app.chrome.getByRole('combobox').fill(`http://127.0.0.1:${(server.address() as AddressInfo).port}/scan.pdf`)
  await app.chrome.getByRole('combobox').press('Enter')
  const page = await app.page('sc://pdf')
  await page.getByRole('button', { name: 'Read text' }).click()
  await expect.poll(() => page.evaluate(() => document.body.innerText), { timeout: 60_000 }).toMatch(/marigold/i)
  await expect(page.getByRole('status')).toHaveCount(0)
  await app.close()
  server.close()
})

test('sc://assistant lists saved chats, opens them and deletes them', async () => {
  const app = await launch()
  await app.chrome.evaluate(async () => {
    await window.scb.invoke('chats:save', 'chat-one', [{ role: 'user', content: 'First question' }, { role: 'assistant', content: 'First answer' }])
    await window.scb.invoke('chats:save', 'chat-two', [{ role: 'user', content: 'Second question' }, { role: 'assistant', content: 'Second answer' }])
    await window.scb.invoke('tabs:navigate', (await window.scb.invoke('tabs:snapshot')).activeId!, 'sc://assistant')
  })
  const page = await app.page('sc://assistant')
  const chats = page.getByRole('navigation', { name: 'Saved chats' })
  await expect(chats.getByRole('link')).toHaveCount(2)
  await chats.getByRole('link', { name: 'First question' }).click()
  await expect(page.getByText('First answer')).toBeVisible()
  await chats.getByRole('link', { name: 'Second question' }).hover()
  await chats.getByRole('listitem').filter({ hasText: 'Second question' }).getByRole('button', { name: 'Delete chat' }).click()
  await expect(chats.getByRole('link')).toHaveCount(1)
  await app.close()
})

test('a finished update shows a restart button, in the toolbar and in Settings', async () => {
  const app = await launch()
  await expect(app.chrome.getByRole('button', { name: 'Restart to update' })).toBeHidden()
  await app.app.evaluate(() => (globalThis as never as { scbUpdates: { set: (patch: object) => void } }).scbUpdates.set({ phase: 'ready', version: '9.9.9' }))
  await expect(app.chrome.getByRole('button', { name: 'Restart to update' })).toBeVisible()
  await app.chrome.evaluate(async () => window.scb.invoke('tabs:navigate', (await window.scb.invoke('tabs:snapshot')).activeId!, 'sc://settings'))
  const page = await app.page('sc://settings')
  await expect(page.getByRole('heading', { name: 'About', level: 2 })).toBeAttached()
  await expect(app.chrome.getByRole('button', { name: 'Restart to update' })).toBeVisible()
  await app.close()
})

test('bookmarks that do not fit move behind a button, and a narrow toolbar empties into More', async () => {
  const app = await launch()
  const { chrome } = app
  await chrome.evaluate(async () => {
    for (let n = 0; n < 40; n++) await window.scb.invoke('bookmarks:toggle', `https://example.com/${n}`, `A bookmark called number ${n}`)
  })
  await expect(chrome.getByRole('button', { name: 'More bookmarks' })).toBeVisible()
  await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(640, 600))
  await expect(chrome.locator('[data-toolbar-slot="downloads"]')).toHaveCount(0)
  await expect(chrome.getByRole('button', { name: 'Assistant' })).toHaveCount(0)
  await expect(chrome.getByRole('button', { name: 'Menu' })).toBeVisible()
  await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1320, 860))
  await expect(chrome.getByRole('button', { name: 'Assistant' })).toBeVisible()
  await app.close()
})

test('the toolbar keeps clear of the window buttons', async () => {
  const app = await launch()
  const clear = await app.chrome.evaluate(() => {
    const area = (navigator as unknown as { windowControlsOverlay: { getTitlebarAreaRect: () => DOMRect } }).windowControlsOverlay.getTitlebarAreaRect()
    const menu = document.querySelector('[aria-label="Menu"]')!.getBoundingClientRect()
    return { menuRight: menu.right, areaRight: area.x + area.width }
  })
  expect(clear.menuRight).toBeLessThanOrEqual(clear.areaRight)
  await app.close()
})
