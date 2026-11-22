import { expect, test } from '@playwright/test'
import { go, launch, type Harness } from './app'

let h: Harness
test.beforeEach(async () => {
  h = await launch()
})
test.afterEach(() => h.close())

const proxyFor = (url: string) => h.app.evaluate(({ session }, address) => session.defaultSession.resolveProxy(address), url)

test('Remove VPN turns it off and hides it everywhere, and Install VPN brings it back with its connections', async () => {
  await go(h, 'sc://vpn')
  const page = await h.page('sc://vpn')
  await page.getByRole('textbox', { name: 'Connection links' }).fill('http://127.0.0.1:9#Local')
  await page.getByRole('button', { name: 'Add links' }).click()
  await expect(page.getByRole('status')).toContainText('Added 1')
  await page.getByRole('switch', { name: 'VPN', exact: true }).click()
  await expect.poll(() => proxyFor('http://other.example.com/')).toContain('127.0.0.1')
  await expect(h.chrome.getByRole('button', { name: 'VPN: on, Local' })).toBeVisible()

  const remove = page.getByRole('region', { name: 'Remove VPN' })
  await remove.getByRole('button', { name: 'Remove VPN' }).click()
  await remove.getByRole('button', { name: 'Remove the VPN?' }).click()
  await expect(page.getByRole('region', { name: 'VPN removed' })).toBeVisible()
  await expect.poll(() => proxyFor('http://other.example.com/')).toBe('DIRECT')
  await expect(h.chrome.getByRole('button', { name: /^VPN:/ })).toHaveCount(0)
  // The page that's open keeps its sidebar entry, so Install VPN is still within reach.
  await expect(page.getByRole('navigation', { name: 'Browser pages' }).getByRole('link', { name: 'VPN' })).toBeVisible()

  // Nothing else can start it while it's removed.
  const summary = await h.app.evaluate(async () => {
    const vpn = (globalThis as unknown as { scbVpn: { turnOn: () => Promise<void>; summary: () => unknown } }).scbVpn
    await vpn.turnOn()
    return vpn.summary()
  })
  expect(summary).toMatchObject({ installed: false, enabled: false })

  await go(h, 'sc://settings/#privacy')
  const settings = await h.page('sc://settings')
  await expect(settings.getByRole('navigation', { name: 'Browser pages' }).getByRole('link', { name: 'VPN' })).toHaveCount(0)
  const install = settings.getByRole('switch', { name: 'Install VPN' })
  await expect(install).not.toBeChecked()
  await install.click()
  await expect(settings.getByRole('switch', { name: 'Remove VPN' })).toBeChecked()
  await expect(settings.getByRole('navigation', { name: 'Browser pages' }).getByRole('link', { name: 'VPN' })).toBeVisible()
  await expect(h.chrome.getByRole('button', { name: 'VPN: off' })).toBeVisible()

  await go(h, 'sc://vpn')
  const again = await h.page('sc://vpn')
  await again.reload()
  await expect(again.getByText('Local', { exact: true })).toBeVisible()
  await again.getByRole('switch', { name: 'VPN', exact: true }).click()
  await expect.poll(() => proxyFor('http://other.example.com/')).toContain('127.0.0.1')

  // The settings switch removes it too, with the connections kept.
  await go(h, 'sc://settings/#privacy')
  const settingsAgain = await h.page('sc://settings')
  await settingsAgain.getByRole('switch', { name: 'Remove VPN' }).click()
  await expect.poll(() => proxyFor('http://other.example.com/')).toBe('DIRECT')
  await expect(h.chrome.getByRole('button', { name: /^VPN:/ })).toHaveCount(0)
})
